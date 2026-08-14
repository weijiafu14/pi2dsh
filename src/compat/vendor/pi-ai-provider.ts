// @ts-nocheck — vendored Pi source excerpts (pi-ai auth/resolve.js ModelsError + models.js createProvider @0.84.1, MIT, see ./PI-LICENSE); logic unchanged.
import { lazyStream } from './pi-ai-lazy.js'
function withCauseDetail(message, cause) {
    if (cause === undefined || cause === null)
        return message;
    const detail = formatThrownValue(cause).trim();
    if (!detail || message.includes(detail))
        return message;
    return `${message}: ${detail}`;
}
export class ModelsError extends Error {
    code;
    constructor(code, message, options) {
        super(withCauseDetail(message, options?.cause), options);
        this.name = "ModelsError";
        this.code = code;
    }
}
/**
 * Builds a provider from parts. Built-in provider factories and models.json
 * custom providers both go through this. A single `api` streams all models;
 * an `api` map dispatches on `model.api`, and a model whose api has no entry
 * produces a stream error.
 */
export function createProvider(input) {
    const baselineModels = input.models;
    let dynamicModels = [];
    const fetchModels = input.fetchModels;
    const currentModels = () => {
        const merged = [...baselineModels];
        for (const model of dynamicModels) {
            const index = merged.findIndex((entry) => entry.id === model.id);
            if (index >= 0)
                merged[index] = model;
            else
                merged.push(model);
        }
        return merged;
    };
    const single = typeof input.api.stream === "function" ? input.api : undefined;
    const byApi = single ? undefined : input.api;
    const apiFor = (model) => single ?? byApi?.[model.api];
    const dispatch = (model, run) => {
        const streams = apiFor(model);
        if (!streams) {
            return lazyStream(model, async () => {
                throw new ModelsError("stream", `Provider ${input.id} has no API implementation for "${model.api}"`);
            });
        }
        return run(streams);
    };
    const provider = {
        id: input.id,
        name: input.name ?? input.id,
        baseUrl: input.baseUrl,
        headers: input.headers,
        auth: input.auth,
        getModels: currentModels,
        refreshModels: fetchModels
            ? async (context) => {
                if (context.stored) {
                    const restored = context.stored.models
                        .filter((model) => model.provider === input.id)
                        .map((model) => model);
                    if (!(await context.publish({
                        update: () => {
                            dynamicModels = restored;
                        },
                    }))) {
                        return;
                    }
                }
                if (!context.allowNetwork || context.signal.aborted)
                    return;
                const refreshed = await fetchModels(context);
                if (context.signal.aborted)
                    return;
                await context.publish({
                    persist: { models: refreshed, checkedAt: Date.now() },
                    update: () => {
                        dynamicModels = refreshed;
                    },
                });
            }
            : undefined,
        filterModels: input.filterModels,
        stream: (model, context, options) => dispatch(model, (streams) => streams.stream(model, context, options)),
        streamSimple: (model, context, options) => dispatch(model, (streams) => streams.streamSimple(model, context, options)),
    };
    const streams = single ? [single] : Object.values(byApi ?? {}).filter((entry) => entry !== undefined);
    if (streams.some((entry) => entry.fetchDeferred !== undefined)) {
        provider.fetchDeferred = (model, handle, options) => lazyStream(model, async () => {
            const implementation = apiFor(model);
            if (!implementation?.fetchDeferred) {
                throw new ModelsError("provider", `Provider ${input.id} does not support deferred responses for "${model.api}"`);
            }
            return implementation.fetchDeferred(model, handle, options);
        });
    }
    if (streams.some((entry) => entry.cancelDeferred !== undefined)) {
        provider.cancelDeferred = async (model, handle, options) => {
            const implementation = apiFor(model);
            if (!implementation?.cancelDeferred) {
                throw new ModelsError("provider", `Provider ${input.id} cannot cancel deferred responses for "${model.api}"`);
            }
            await implementation.cancelDeferred(model, handle, options);
        };
    }
    return provider;
}
