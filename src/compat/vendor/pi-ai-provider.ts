// @ts-nocheck — Pi v1.4.0 (4a08025), MIT (./PI-LICENSE). createProvider/hasKnownModelType excerpts; logic unchanged.
import { lazyStream } from './pi-ai-lazy.js'
import type { AnyModel, Api, CreateProviderOptions, Provider, ProviderStreams, ProviderImages, ProviderClassifier, ProviderModel, Model, AssistantMessageEventStream } from '@earendil-works/pi-ai'
import { ModelsError } from './pi-ai-models-error.js'
import { getModelType, isModelType, imageErrorResult, classifierErrorResult } from './pi-ai-model-operations.js'
export { ModelsError } from './pi-ai-models-error.js'
const KNOWN_MODEL_TYPES = { chat: true, image: true, classifier: true }

function hasKnownModelType(model: AnyModel): boolean {
	return Object.hasOwn(KNOWN_MODEL_TYPES, getModelType(model));
}

export function createProvider<TApi extends Api = Api>(input: CreateProviderOptions<TApi>): Provider<TApi> {
	const single =
		input.api && typeof (input.api as ProviderStreams).stream === "function"
			? (input.api as ProviderStreams)
			: undefined;
	const byApi = single || !input.api ? undefined : (input.api as Partial<Record<string, ProviderStreams>>);
	const images = input.images as Partial<Record<string, ProviderImages>> | undefined;
	const classifiers = input.classifiers as Partial<Record<string, ProviderClassifier>> | undefined;
	const streams = single ? [single] : Object.values(byApi ?? {}).filter((entry) => entry !== undefined);
	const imageImplementations = Object.values(images ?? {}).filter((entry) => entry !== undefined);
	const classifierImplementations = Object.values(classifiers ?? {}).filter((entry) => entry !== undefined);
	if (streams.length === 0 && imageImplementations.length === 0 && classifierImplementations.length === 0) {
		throw new Error(`Provider ${input.id}: at least one of "api", "images", or "classifiers" is required.`);
	}

	const baselineModels = input.models;
	let dynamicModels: readonly ProviderModel<TApi>[] = [];
	const fetchModels = input.fetchModels;
	const currentModels = (): readonly ProviderModel<TApi>[] => {
		const merged = [...baselineModels];
		for (const model of dynamicModels) {
			const index = merged.findIndex(
				(entry) => getModelType(entry) === getModelType(model) && entry.id === model.id,
			);
			if (index >= 0) merged[index] = model;
			else merged.push(model);
		}
		return merged;
	};
	const apiFor = (model: Model<Api>): ProviderStreams | undefined => single ?? byApi?.[model.api];

	const dispatch = (
		model: Model<Api>,
		run: (streams: ProviderStreams) => AssistantMessageEventStream,
	): AssistantMessageEventStream => {
		const streams = apiFor(model);
		if (!streams) {
			return lazyStream(model, async () => {
				throw new ModelsError("stream", `Provider ${input.id} has no API implementation for "${model.api}"`);
			});
		}
		return run(streams);
	};

	const provider: Provider<TApi> = {
		id: input.id,
		name: input.name ?? input.id,
		baseUrl: input.baseUrl,
		headers: input.headers,
		auth: input.auth,
		getModels: () => currentModels().filter((model): model is Model<TApi> => isModelType(model, "chat")),
		getAllModels: currentModels,
		refreshModels: fetchModels
			? async (context) => {
					if (context.stored) {
						const restored = context.stored.models
							.filter((model) => model.provider === input.id)
							.map((model) => model as ProviderModel<TApi>);
						if (
							!(await context.publish({
								update: () => {
									dynamicModels = restored;
								},
							}))
						) {
							return;
						}
					}
					if (!context.allowNetwork || context.signal.aborted) return;
					const fetched = await fetchModels(context);
					if (context.signal.aborted) return;
					const refreshed = fetched.filter(hasKnownModelType);
					await context.publish({
						persist: { models: refreshed, checkedAt: Date.now() },
						update: () => {
							dynamicModels = refreshed;
						},
					});
				}
			: undefined,
		filterModels: input.filterModels,
		filterAllModels: input.filterAllModels,
		stream: (model, context, options) => dispatch(model, (streams) => streams.stream(model, context, options)),
		streamSimple: (model, context, options) =>
			dispatch(model, (streams) => streams.streamSimple(model, context, options)),
	};

	if (streams.some((entry) => entry.fetchDeferred !== undefined)) {
		provider.fetchDeferred = (model, handle, options) =>
			lazyStream(model, async () => {
				const implementation = apiFor(model);
				if (!implementation?.fetchDeferred) {
					throw new ModelsError(
						"provider",
						`Provider ${input.id} does not support deferred responses for "${model.api}"`,
					);
				}
				return implementation.fetchDeferred(model, handle, options);
			});
	}
	if (streams.some((entry) => entry.cancelDeferred !== undefined)) {
		provider.cancelDeferred = async (model, handle, options) => {
			const implementation = apiFor(model);
			if (!implementation?.cancelDeferred) {
				throw new ModelsError(
					"provider",
					`Provider ${input.id} cannot cancel deferred responses for "${model.api}"`,
				);
			}
			await implementation.cancelDeferred(model, handle, options);
		};
	}
	if (images && imageImplementations.length > 0) {
		provider.generateImages = async (model, context, options) => {
			const implementation = images[model.api];
			if (!implementation) {
				return imageErrorResult(
					model,
					new ModelsError(
						"provider",
						`Provider ${input.id} has no image generation implementation for "${model.api}"`,
					),
				);
			}
			return implementation.generateImages(model, context, options);
		};
	}
	if (classifiers && classifierImplementations.length > 0) {
		provider.classify = async (model, context, options) => {
			const implementation = classifiers[model.api];
			if (!implementation) {
				return classifierErrorResult(
					model,
					new ModelsError("provider", `Provider ${input.id} has no classifier implementation for "${model.api}"`),
				);
			}
			return implementation.classify(model, context, options);
		};
	}

	return provider;
}
