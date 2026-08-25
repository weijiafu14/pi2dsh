window.__ModuleLoader__.load({
	id: "dsh-work-x",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/ansi.ts
		/** The 8 base ANSI colours, in SGR order, as CSS. */
		const BASE = [
			"#000000",
			"#cd3131",
			"#0dbc79",
			"#e5e510",
			"#2472c8",
			"#bc3fbc",
			"#11a8cd",
			"#e5e5e5"
		];
		/** Their bright variants (SGR 90-97 / 100-107). */
		const BRIGHT = [
			"#666666",
			"#f14c4c",
			"#23d18b",
			"#f5f543",
			"#3b8eea",
			"#d670d6",
			"#29b8db",
			"#ffffff"
		];
		/**
		* Resolve one xterm-256 index to CSS.
		* @param index - the palette index (0-255).
		* @returns a CSS colour.
		*/
		function ansi256(index) {
			if (index < 8) return BASE[index];
			if (index < 16) return BRIGHT[index - 8];
			if (index < 232) {
				const step = (value) => value === 0 ? 0 : value * 40 + 55;
				const rest = index - 16;
				return `rgb(${step(Math.floor(rest / 36))}, ${step(Math.floor(rest / 6) % 6)}, ${step(rest % 6)})`;
			}
			const grey = (index - 232) * 10 + 8;
			return `rgb(${grey}, ${grey}, ${grey})`;
		}
		const SGR = String.raw`\[([0-9;]*)m`;
		/**
		* Split text into styled runs.
		*
		* Unrecognised escapes are dropped rather than printed — a code this does not
		* model is still not something a reader should see as text. Text with no
		* escapes comes back as a single unstyled run, so callers need no special case.
		* @param text - possibly carrying SGR escapes.
		* @returns the runs, in order; empty only for empty input.
		*/
		function parseAnsi(text) {
			const pattern = new RegExp(SGR, "gu");
			const runs = [];
			let style = {};
			let at = 0;
			const push = (piece) => {
				if (piece.length > 0) runs.push({
					text: piece,
					style: { ...style }
				});
			};
			for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
				push(text.slice(at, match.index));
				at = match.index + match[0].length;
				const codes = (match[1] ?? "").split(";").filter((part) => part !== "").map(Number);
				if (codes.length === 0) style = {};
				for (let index = 0; index < codes.length; index += 1) {
					const code = codes[index];
					if (code === 0) style = {};
					else if (code === 1) style.fontWeight = "bold";
					else if (code === 2) style.opacity = "0.7";
					else if (code === 3) style.fontStyle = "italic";
					else if (code === 4) style.textDecoration = "underline";
					else if (code === 39) delete style.color;
					else if (code === 49) delete style.backgroundColor;
					else if (code >= 30 && code <= 37) style.color = BASE[code - 30];
					else if (code >= 90 && code <= 97) style.color = BRIGHT[code - 90];
					else if (code >= 40 && code <= 47) style.backgroundColor = BASE[code - 40];
					else if (code >= 100 && code <= 107) style.backgroundColor = BRIGHT[code - 100];
					else if (code === 38 || code === 48) {
						const property = code === 38 ? "color" : "backgroundColor";
						const kind = codes[index + 1];
						if (kind === 5 && codes.length > index + 2) {
							style[property] = ansi256(codes[index + 2]);
							index += 2;
						} else if (kind === 2 && codes.length > index + 4) {
							style[property] = `rgb(${codes[index + 2]}, ${codes[index + 3]}, ${codes[index + 4]})`;
							index += 4;
						}
					}
				}
			}
			push(text.slice(at));
			return runs;
		}
		/**
		* Whether text carries any SGR escape.
		* @param text - the text to check.
		* @returns true when at least one escape is present.
		*/
		function hasAnsi(text) {
			return new RegExp(SGR, "u").test(text);
		}
		//#endregion
		//#region src/client.ts
		/** Services this half needs before it can take a seat. */
		const inject$1 = ["slots", "inputTriggers"];
		const POLL_MS = 1e3;
		const EMPTY = {
			threads: [],
			surfaces: [],
			entries: []
		};
		/**
		* One poller per session, shared by every seat this package takes.
		*
		* Four components read the same payload; four independent timers would be four
		* requests a second for one answer.
		*/
		const subscribers = /* @__PURE__ */ new Map();
		const latest = /* @__PURE__ */ new Map();
		const timers = /* @__PURE__ */ new Map();
		/**
		* Subscribe to one session's browser state.
		* @param session - session id to poll for.
		* @param notify - called with each payload, and immediately with the last one.
		* @returns an unsubscribe function that stops the timer with the last reader.
		*/
		function watch(session, notify) {
			const readers = subscribers.get(session) ?? /* @__PURE__ */ new Set();
			readers.add(notify);
			subscribers.set(session, readers);
			const cached = latest.get(session);
			if (cached !== void 0) notify(cached);
			if (!timers.has(session)) {
				const poll = async () => {
					try {
						const response = await fetch(`/pi2dsh/browser-state?session=${encodeURIComponent(session)}`);
						if (!response.ok) return;
						const payload = await response.json();
						const state = {
							threads: Array.isArray(payload.threads) ? payload.threads : [],
							surfaces: Array.isArray(payload.surfaces) ? payload.surfaces : [],
							entries: Array.isArray(payload.entries) ? payload.entries : [],
							...payload.draft === void 0 ? {} : { draft: payload.draft },
							...payload.scene === void 0 ? {} : { scene: payload.scene }
						};
						latest.set(session, state);
						for (const reader of subscribers.get(session) ?? []) reader(state);
					} catch {}
				};
				poll();
				timers.set(session, window.setInterval(() => {
					poll();
				}, POLL_MS));
			}
			return () => {
				const live = subscribers.get(session);
				if (live === void 0) return;
				live.delete(notify);
				if (live.size > 0) return;
				subscribers.delete(session);
				const timer = timers.get(session);
				if (timer !== void 0) window.clearInterval(timer);
				timers.delete(session);
				latest.delete(session);
			};
		}
		/**
		* React binding for {@link watch}.
		* @param session - session id, or undefined while none is selected.
		* @returns the latest payload for that session.
		*/
		function useBrowserState(session) {
			const [state, setState] = (0, react.useState)(EMPTY);
			(0, react.useEffect)(() => {
				if (session === void 0 || session === "") {
					setState(EMPTY);
					return;
				}
				return watch(session, setState);
			}, [session]);
			return state;
		}
		/** The working keys Pi's setWorkingVisible gates: hidden while hidden. */
		const WORKING_KEYS = [
			"workingMessage",
			"workingIndicator",
			"hiddenThinkingLabel"
		];
		/** Every value packages have set for one simple surface, in package order. */
		function valuesFor(surfaces, key) {
			const out = [];
			for (const surface of surfaces) {
				if (WORKING_KEYS.includes(key) && !surface.workingVisible) continue;
				const text = surface.values[key];
				if (text !== void 0) out.push({
					owner: surface.package ?? "pi",
					text
				});
			}
			return out;
		}
		/** Every status entry, package by package, then key, in registration order. */
		function statusesFor(surfaces) {
			const out = [];
			for (const surface of surfaces) for (const [key, text] of Object.entries(surface.statuses)) out.push({
				owner: surface.package ?? "pi",
				key,
				text
			});
			return out;
		}
		/** Every widget, package by package, then key, in registration order. */
		function widgetsFor(surfaces) {
			const out = [];
			for (const surface of surfaces) for (const [key, text] of Object.entries(surface.widgets)) out.push({
				owner: surface.package ?? "pi",
				key,
				text
			});
			return out;
		}
		const styles = {
			sceneBackdrop: {
				position: "fixed",
				inset: 0,
				zIndex: 60,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "rgba(0,0,0,0.45)",
				pointerEvents: "auto"
			},
			sceneFrame: {
				maxWidth: "92vw",
				maxHeight: "86vh",
				display: "flex",
				flexDirection: "column",
				borderRadius: "12px",
				border: "1px solid rgba(120,120,130,0.35)",
				background: "var(--dsh-color-bg-elevated, rgba(18,18,21,0.98))",
				color: "var(--dsh-color-text, #fafafa)",
				boxShadow: "0 18px 48px rgba(0,0,0,0.45)",
				overflow: "hidden"
			},
			sceneHeader: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				padding: "8px 12px",
				borderBottom: "1px solid rgba(120,120,130,0.25)",
				font: "500 12px/1.4 system-ui, -apple-system, sans-serif",
				opacity: .9
			},
			sceneBody: {
				margin: 0,
				padding: "12px 14px",
				overflow: "auto",
				font: "400 12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
				whiteSpace: "pre"
			},
			panel: {
				position: "fixed",
				right: "20px",
				bottom: "108px",
				zIndex: 40,
				width: "340px",
				maxHeight: "48vh",
				display: "flex",
				flexDirection: "column",
				pointerEvents: "auto",
				overflow: "hidden",
				borderRadius: "12px",
				border: "1px solid rgba(120,120,130,0.28)",
				background: "var(--dsh-color-bg-elevated, rgba(24,24,27,0.96))",
				color: "var(--dsh-color-text, #fafafa)",
				boxShadow: "0 12px 32px rgba(0,0,0,0.32)",
				font: "400 13px/1.55 system-ui, -apple-system, sans-serif"
			},
			header: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "8px",
				padding: "10px 12px",
				borderBottom: "1px solid rgba(120,120,130,0.22)",
				fontWeight: 500,
				fontSize: "12px",
				letterSpacing: "0.01em"
			},
			badge: {
				opacity: .6,
				fontWeight: 400
			},
			body: {
				padding: "10px 12px",
				overflowY: "auto",
				display: "flex",
				flexDirection: "column",
				gap: "10px"
			},
			role: {
				fontSize: "11px",
				textTransform: "uppercase",
				letterSpacing: "0.06em",
				opacity: .55
			},
			text: {
				whiteSpace: "pre-wrap",
				wordBreak: "break-word"
			},
			close: {
				cursor: "pointer",
				opacity: .55,
				background: "none",
				border: "none",
				color: "inherit",
				font: "inherit"
			},
			pillStack: {
				position: "fixed",
				right: "20px",
				bottom: "20px",
				zIndex: 39,
				display: "flex",
				flexDirection: "column",
				alignItems: "flex-end",
				gap: "6px",
				pointerEvents: "none"
			},
			pill: {
				pointerEvents: "auto",
				padding: "5px 10px",
				borderRadius: "999px",
				background: "var(--dsh-color-bg-elevated, rgba(24,24,27,0.92))",
				color: "var(--dsh-color-text, #fafafa)",
				border: "1px solid rgba(120,120,130,0.28)",
				font: "500 11px/1.4 system-ui, sans-serif",
				whiteSpace: "pre-wrap"
			},
			inline: {
				font: "400 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
				whiteSpace: "pre-wrap",
				opacity: .85
			},
			strip: {
				display: "flex",
				flexDirection: "column",
				gap: "4px",
				padding: "4px 2px"
			},
			imageTool: {
				margin: "4px 0",
				overflow: "hidden",
				borderRadius: "8px",
				border: "1px solid rgba(120,120,130,0.22)",
				background: "var(--dsh-color-bg-subtle, rgba(120,120,130,0.06))",
				color: "var(--dsh-color-text, inherit)",
				font: "400 12px/1.5 system-ui, sans-serif"
			},
			imageToolToggle: {
				width: "100%",
				display: "flex",
				alignItems: "center",
				gap: "8px",
				padding: "8px 10px",
				cursor: "pointer",
				border: "none",
				background: "transparent",
				color: "inherit",
				textAlign: "left",
				font: "500 12px/1.5 system-ui, sans-serif"
			},
			imageToolStatus: {
				color: "#2FBC44",
				fontSize: "10px"
			},
			imageToolSummary: {
				opacity: .62,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			imageToolBody: {
				display: "flex",
				flexDirection: "column",
				gap: "8px",
				padding: "0 10px 10px",
				borderTop: "1px solid rgba(120,120,130,0.14)"
			},
			imageToolText: {
				margin: "8px 0 0",
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
				opacity: .82
			},
			imageGrid: {
				display: "flex",
				flexWrap: "wrap",
				gap: "8px"
			},
			imageFrame: {
				display: "block",
				maxWidth: "min(320px, 100%)",
				maxHeight: "320px",
				borderRadius: "8px",
				objectFit: "contain",
				background: "rgba(0,0,0,0.08)"
			},
			imageError: {
				padding: "12px",
				color: "#F63218"
			}
		};
		/** Pull one image through DSH's own session-authorized attachment RPC. */
		function AuthorizedToolImage({ sessionId, attachment }) {
			const [url, setUrl] = (0, react.useState)(void 0);
			const [failed, setFailed] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				let objectUrl;
				(async () => {
					try {
						const response = await fetch("/api/session.attachment", {
							method: "POST",
							headers: { "content-type": "application/json" },
							signal: controller.signal,
							body: JSON.stringify({
								type: "client-request",
								rpcId: `pi2dsh-image-${Date.now()}-${Math.random().toString(36).slice(2)}`,
								method: "session.attachment",
								payload: {
									sessionId,
									attachmentId: attachment.attachmentId
								}
							})
						});
						const envelope = await response.json();
						const data = envelope.result?.ok === true ? envelope.result.value?.data : void 0;
						if (!response.ok || typeof data !== "string") throw new Error("attachment unavailable");
						const binary = atob(data);
						const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
						objectUrl = URL.createObjectURL(new Blob([bytes], { type: attachment.mediaType }));
						if (!controller.signal.aborted) setUrl(objectUrl);
					} catch {
						if (!controller.signal.aborted) setFailed(true);
					}
				})();
				return () => {
					controller.abort();
					if (objectUrl !== void 0) URL.revokeObjectURL(objectUrl);
				};
			}, [
				sessionId,
				attachment.attachmentId,
				attachment.mediaType
			]);
			if (failed) return (0, react.createElement)("div", { style: styles.imageError }, "Image attachment could not be loaded.");
			if (url === void 0) return (0, react.createElement)("div", { style: styles.imageToolText }, "Loading image…");
			return (0, react.createElement)("img", {
				src: url,
				alt: attachment.name ?? "Image returned by Pi tool",
				style: styles.imageFrame,
				"data-pi2dsh": "tool-image"
			});
		}
		function firstArgumentSummary(raw) {
			try {
				const parsed = JSON.parse(raw);
				const preferred = parsed.prompt ?? parsed.description;
				if (typeof preferred === "string") return preferred;
				const first = Object.values(parsed).find((value) => typeof value === "string");
				return typeof first === "string" ? first : "";
			} catch {
				return raw;
			}
		}
		/** Browser row shared by the explicitly supported Pi image tools. */
		function PiImageToolView({ toolName, block, sessionId }) {
			const [expanded, setExpanded] = (0, react.useState)(true);
			const settled = block.kind === "tool-result";
			const argsRaw = settled ? block.call?.argsRaw ?? "" : block.argsRaw ?? "";
			const content = settled && Array.isArray(block.content) ? block.content : [];
			const images = content.flatMap((item) => item.type === "image" && item.attachment !== void 0 ? [item.attachment] : []);
			const text = content.filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.text).join("\n");
			const summary = firstArgumentSummary(argsRaw);
			return (0, react.createElement)("div", {
				style: styles.imageTool,
				"data-pi2dsh": "image-tool-result",
				"data-tool": toolName
			}, (0, react.createElement)("button", {
				type: "button",
				style: styles.imageToolToggle,
				"aria-expanded": expanded,
				onClick: () => setExpanded((value) => !value)
			}, (0, react.createElement)("span", { style: styles.imageToolStatus }, block.isError === true ? "●" : settled ? "●" : "◌"), (0, react.createElement)("span", null, toolName), summary === "" ? null : (0, react.createElement)("span", { style: styles.imageToolSummary }, `· ${summary}`)), !expanded ? null : (0, react.createElement)("div", { style: styles.imageToolBody }, text === "" ? null : (0, react.createElement)("div", { style: styles.imageToolText }, text), sessionId === void 0 || images.length === 0 ? null : (0, react.createElement)("div", { style: styles.imageGrid }, ...images.map((attachment) => (0, react.createElement)(AuthorizedToolImage, {
				key: attachment.attachmentId,
				sessionId,
				attachment
			})))));
		}
		/**
		* Register the image row under exact tool names published at package mount.
		* Only known image tools appear in that list, so text-only and native tools
		* retain DSH's existing cards.
		*/
		function installImageToolViews(scope) {
			const installed = /* @__PURE__ */ new Set();
			const start = () => {
				let live = true;
				const sync = async () => {
					try {
						const response = await fetch("/pi2dsh/image-tool-names");
						if (!response.ok || !live) return;
						const payload = await response.json();
						if (!Array.isArray(payload.names)) return;
						for (const value of payload.names) {
							if (typeof value !== "string" || value === "" || installed.has(value)) continue;
							installed.add(value);
							scope.slots.inject("tool.call.toolview", () => scope.slots.register({
								name: "tool.call.toolview",
								key: value
							}, PiImageToolView));
						}
					} catch {}
				};
				sync();
				const timer = window.setInterval(() => {
					sync();
				}, POLL_MS);
				return () => {
					live = false;
					window.clearInterval(timer);
				};
			};
			if (scope.effect !== void 0) scope.effect(start, "pi2dsh: image tool views");
			else start();
		}
		/**
		* The frame-wide seat: the side-conversation panel, plus whatever packages
		* pinned frame-wide — transient title and Pi's status entries, as pills.
		* @param props - the global standard kit every root slot component receives.
		*/
		/** Browser KeyboardEvent -> the raw terminal sequence a Pi component expects. */
		function terminalSequence(event) {
			if (event.metaKey) return void 0;
			switch (event.key) {
				case "Enter": return "\r";
				case "Escape": return "\x1B";
				case "Tab": return "	";
				case "Backspace": return "";
				case "Delete": return "\x1B[3~";
				case "ArrowUp": return "\x1B[A";
				case "ArrowDown": return "\x1B[B";
				case "ArrowRight": return "\x1B[C";
				case "ArrowLeft": return "\x1B[D";
				case "Home": return "\x1B[H";
				case "End": return "\x1B[F";
				case "PageUp": return "\x1B[5~";
				case "PageDown": return "\x1B[6~";
			}
			if (event.key.length !== 1) return void 0;
			if (event.ctrlKey) {
				const code = event.key.toLowerCase().charCodeAt(0);
				return code >= 97 && code <= 122 ? String.fromCharCode(code - 96) : void 0;
			}
			return event.key;
		}
		/**
		* Pi's full-screen custom UI (`ui.custom`) on the web: the same ANSI frames a
		* terminal scene would show, painted in a modal, with the keyboard forwarded
		* verbatim to the live component on the server. The component owns its own
		* lifecycle — most panels close themselves (their `done`) — and the × button
		* is the browser's equivalent of closing the terminal scene.
		*/
		function SceneOverlay({ useSessions }) {
			const { scene } = useBrowserState(useSessions((state) => state.current));
			const open = scene?.open === true;
			(0, react.useEffect)(() => {
				if (!open) return;
				const columns = Math.max(40, Math.min(240, Math.floor(window.innerWidth * .86 / 8.4)));
				fetch("/pi2dsh/scene-input", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						sequence: "",
						width: columns
					})
				});
				const onKey = (event) => {
					const sequence = terminalSequence(event);
					if (sequence === void 0) return;
					event.preventDefault();
					event.stopPropagation();
					fetch("/pi2dsh/scene-input", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sequence })
					});
				};
				window.addEventListener("keydown", onKey, true);
				return () => window.removeEventListener("keydown", onKey, true);
			}, [open]);
			if (!open) return null;
			const lines = scene?.lines ?? [];
			return (0, react.createElement)("div", {
				style: styles.sceneBackdrop,
				"data-pi2dsh": "scene"
			}, (0, react.createElement)("div", { style: styles.sceneFrame }, (0, react.createElement)("div", { style: styles.sceneHeader }, (0, react.createElement)("span", null, scene?.package ?? ""), (0, react.createElement)("button", {
				style: styles.close,
				title: "Close",
				onClick: () => {
					fetch("/pi2dsh/scene-close", { method: "POST" });
				}
			}, "×")), (0, react.createElement)("pre", { style: styles.sceneBody }, ...lines.map((line, index) => (0, react.createElement)("div", { key: index }, ansiText(line))))));
		}
		function OverlaySurfaces({ useSessions }) {
			const { threads, surfaces } = useBrowserState(useSessions((state) => state.current));
			const [dismissed, setDismissed] = (0, react.useState)([]);
			const shown = threads.filter((thread) => !dismissed.includes(thread.id));
			const pills = [...valuesFor(surfaces, "title").map((entry) => ({
				...entry,
				key: "title"
			})), ...statusesFor(surfaces)];
			if (shown.length === 0 && pills.length === 0) return null;
			return (0, react.createElement)("div", null, pills.length === 0 ? null : (0, react.createElement)("div", {
				style: styles.pillStack,
				"data-pi2dsh": "pills"
			}, ...pills.map((pill, index) => (0, react.createElement)("div", {
				key: `${pill.owner}-${pill.key}-${index}`,
				style: styles.pill,
				title: pill.owner
			}, ansiText(pill.text)))), shown.length === 0 ? null : (0, react.createElement)("div", {
				"data-pi2dsh": "side-panel",
				style: styles.panel
			}, ...shown.map((thread) => (0, react.createElement)("div", {
				key: thread.id,
				style: { display: "contents" }
			}, (0, react.createElement)("div", { style: styles.header }, (0, react.createElement)("span", null, thread.label), (0, react.createElement)("span", { style: styles.badge }, thread.running ? "running" : `${thread.messages.length} msg`), (0, react.createElement)("button", {
				style: styles.close,
				title: "Hide",
				onClick: () => setDismissed((list) => [...list, thread.id])
			}, "×")), (0, react.createElement)("div", { style: styles.body }, ...thread.messages.map((message, index) => (0, react.createElement)("div", { key: index }, (0, react.createElement)("div", { style: styles.role }, message.role), (0, react.createElement)("div", { style: styles.text }, message.text))))))));
		}
		/**
		* One session-scoped seat rendering a set of surfaces as text.
		* @param marker - the data-pi2dsh value, so an e2e run can address the seat.
		* @param valueKeys - which simple value surfaces this seat shows.
		* @param opts - whether the seat also shows widgets (keyed string arrays).
		* @returns a slot component.
		*/
		/**
		* Render text that may carry ANSI colour into styled spans.
		*
		* Parsing lives in ./ansi.js so it can be tested without a DOM; this half
		* only turns runs into elements. Text with no escapes returns as a plain
		* string, so the common case adds no wrappers.
		* @param text - the seat text, possibly with SGR escapes.
		* @returns react children.
		*/
		function ansiText(text) {
			if (!hasAnsi(text)) return text;
			return parseAnsi(text).map((run, index) => Object.keys(run.style).length === 0 ? run.text : (0, react.createElement)("span", {
				key: `ansi-${index}`,
				style: run.style
			}, run.text));
		}
		function textSeat(marker, valueKeys, opts = {}) {
			return function TextSeat({ sessionId }) {
				const { surfaces } = useBrowserState(sessionId);
				const entries = [...valueKeys.flatMap((key) => valuesFor(surfaces, key)), ...opts.widgets === true ? widgetsFor(surfaces) : []];
				if (entries.length === 0) return null;
				return (0, react.createElement)("div", {
					"data-pi2dsh": marker,
					style: styles.strip
				}, ...entries.map((entry, index) => (0, react.createElement)("div", {
					key: `${entry.owner}-${index}`,
					style: styles.inline,
					title: entry.owner
				}, ansiText(entry.text))));
			};
		}
		/**
		* Custom entries a package appended and renders itself.
		*
		* They live in pi2dsh's sidecar, not DSH's durable log — the host has no
		* channel for event types declared outside the harness — so the host's own
		* conversation view cannot show them. This seat is where a package's own
		* entries become visible, drawn by the package's registered renderer.
		* @param props - the session standard kit.
		* @returns the entry strip, or null when the package appended none.
		*/
		function EntryStrip({ sessionId }) {
			const { entries } = useBrowserState(sessionId);
			if (entries.length === 0) return null;
			return (0, react.createElement)("div", {
				"data-pi2dsh": "entries",
				style: styles.strip
			}, ...entries.map((entry) => (0, react.createElement)("div", {
				key: entry.id,
				style: styles.inline,
				title: `${entry.package ?? "pi"} · ${entry.customType}`
			}, ansiText(entry.text))));
		}
		/**
		* The composer half of Pi's editor calls.
		*
		* `inputActions` is part of the session standard kit — every session-scoped
		* slot component receives it — so a package's `setEditorText`/`pasteToEditor`
		* reaches the real composer instead of a buffer nobody reads. The traffic is
		* two-way on purpose: the live draft is reported back so a package's
		* `getEditorText` reads what the user actually has, not only its own last
		* write.
		* @param props - the session standard kit (state hook plus input actions).
		* @returns nothing rendered; this seat exists for the effects.
		*/
		function ComposerBridge({ sessionId, useInput, inputActions }) {
			const { draft } = useBrowserState(sessionId);
			const live = useInput === void 0 ? "" : useInput((state) => state.draft);
			const [appliedRev, setAppliedRev] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				if (draft === void 0 || inputActions === void 0) return;
				if (draft.rev <= appliedRev) return;
				setAppliedRev(draft.rev);
				inputActions.setDraft(draft.text);
			}, [
				draft?.rev,
				draft?.text,
				inputActions,
				appliedRev
			]);
			(0, react.useEffect)(() => {
				if (sessionId === void 0 || sessionId === "") return;
				fetch("/pi2dsh/editor-draft", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						session: sessionId,
						draft: live
					})
				}).catch(() => {});
			}, [sessionId, live]);
			return null;
		}
		/**
		* Client plugin body: take the seats this package draws into.
		* @param ctx - client root context.
		*/
		function apply$1(ctx) {
			ctx.inject(["inputTriggers"], (scope) => {
				const triggers = scope.inputTriggers;
				if (triggers === void 0) return;
				triggers.registerSource({
					trigger: "@",
					name: "pi2dsh",
					order: 50,
					candidates: async (_session, req) => {
						try {
							const response = await fetch(`/pi2dsh/completions?trigger=${encodeURIComponent("@")}&query=${encodeURIComponent(req.query)}`, { signal: req.signal });
							if (!response.ok) return [];
							return ((await response.json()).items ?? []).map((item) => ({
								name: item.value,
								...item.description === void 0 ? {} : { description: item.description }
							}));
						} catch {
							return [];
						}
					},
					onPick: (pick) => ({ text: pick.candidate.name })
				});
			});
			ctx.inject(["slots"], (scope) => {
				installImageToolViews(scope);
				scope.slots.inject("shell.overlay", () => scope.slots.register({
					name: "shell.overlay",
					id: "pi2dsh-overlay",
					order: 1
				}, OverlaySurfaces));
				scope.slots.inject("shell.overlay", () => scope.slots.register({
					name: "shell.overlay",
					id: "pi2dsh-scene",
					order: 2
				}, SceneOverlay));
				scope.slots.inject("conversation.session.header.utilities", () => scope.slots.register({
					name: "conversation.session.header.utilities",
					id: "pi2dsh-header",
					order: 1
				}, textSeat("header", ["header"])));
				scope.slots.inject("conversation.input.dock", () => scope.slots.register({
					name: "conversation.input.dock",
					id: "pi2dsh-dock",
					order: 1
				}, textSeat("dock", [], { widgets: true })));
				scope.slots.inject("conversation.chat.turnTail", () => scope.slots.register({
					name: "conversation.chat.turnTail",
					id: "pi2dsh-entries",
					order: 1,
					select: () => ({})
				}, EntryStrip));
				scope.slots.inject("conversation.input.dock", () => scope.slots.register({
					name: "conversation.input.dock",
					id: "pi2dsh-composer-bridge",
					order: 2
				}, ComposerBridge));
				scope.slots.inject("conversation.composer.dock", () => scope.slots.register({
					name: "conversation.composer.dock",
					id: "pi2dsh-working",
					order: 1
				}, textSeat("working", [
					"footer",
					"workingMessage",
					"workingIndicator",
					"hiddenThinkingLabel"
				])));
			});
		}
		//#endregion
		//#region dsh-x/src/mcp-tab.ts
		const ui = {
			root: {
				display: "flex",
				flexDirection: "column",
				gap: "10px",
				padding: "12px",
				font: "400 13px/1.5 system-ui, -apple-system, sans-serif",
				color: "var(--dsh-color-text, #1b1b1b)"
			},
			headline: {
				font: "600 13px/1.4 system-ui, sans-serif",
				display: "flex",
				justifyContent: "space-between",
				alignItems: "baseline"
			},
			group: {
				font: "600 11px/1.4 system-ui, sans-serif",
				opacity: .55,
				textTransform: "uppercase",
				letterSpacing: "0.06em",
				marginTop: "4px"
			},
			sub: {
				opacity: .65,
				fontSize: "12px"
			},
			card: {
				border: "1px solid rgba(120,120,130,0.25)",
				borderRadius: "10px",
				padding: "10px 12px",
				display: "flex",
				flexDirection: "column",
				gap: "6px",
				background: "var(--dsh-color-bg-elevated, rgba(127,127,127,0.04))"
			},
			cardHead: {
				display: "flex",
				alignItems: "center",
				gap: "8px"
			},
			name: { font: "600 13px/1.4 ui-monospace, monospace" },
			badge: {
				fontSize: "10.5px",
				padding: "1px 7px",
				borderRadius: "999px",
				border: "1px solid rgba(120,120,130,0.35)",
				opacity: .8
			},
			target: {
				font: "400 11.5px/1.5 ui-monospace, monospace",
				opacity: .75,
				wordBreak: "break-all"
			},
			meta: {
				fontSize: "11px",
				opacity: .6
			},
			toggle: {
				marginLeft: "auto",
				fontSize: "12px",
				padding: "3px 10px",
				borderRadius: "7px",
				border: "1px solid rgba(120,120,130,0.4)",
				background: "transparent",
				color: "inherit",
				cursor: "pointer"
			},
			note: {
				fontSize: "12px",
				padding: "6px 10px",
				borderRadius: "8px",
				background: "rgba(40,159,234,0.12)"
			},
			empty: {
				padding: "14px",
				borderRadius: "10px",
				border: "1px dashed rgba(120,120,130,0.4)",
				fontSize: "12.5px",
				lineHeight: 1.7
			},
			code: {
				font: "500 11.5px/1.5 ui-monospace, monospace",
				background: "rgba(127,127,127,0.12)",
				padding: "1px 5px",
				borderRadius: "4px"
			}
		};
		function useMcpState(session, active) {
			const [state, setState] = (0, react.useState)(void 0);
			const [failed, setFailed] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (!active) return;
				let live = true;
				const pull = async () => {
					try {
						const response = await fetch(`/pi2dsh/mcp-state?session=${encodeURIComponent(session)}`);
						if (!live) return;
						if (!response.ok) {
							setFailed(true);
							return;
						}
						setState(await response.json());
						setFailed(false);
					} catch {
						if (live) setFailed(true);
					}
				};
				pull();
				const timer = window.setInterval(() => {
					pull();
				}, 4e3);
				return () => {
					live = false;
					window.clearInterval(timer);
				};
			}, [active, session]);
			return {
				state,
				failed,
				patch: (update) => setState((current) => current === void 0 ? current : update(current))
			};
		}
		function serverCard(server, onToggle, toggleTitle) {
			return (0, react.createElement)("div", {
				key: server.name,
				style: {
					...ui.card,
					opacity: server.disabled ? .55 : 1
				},
				"data-dsh-x": "mcp-server"
			}, (0, react.createElement)("div", { style: ui.cardHead }, (0, react.createElement)("span", { style: ui.name }, server.name), (0, react.createElement)("span", { style: ui.badge }, server.transport), server.disabled ? (0, react.createElement)("span", { style: ui.badge }, "disabled") : null, (0, react.createElement)("button", {
				style: ui.toggle,
				title: toggleTitle,
				onClick: () => onToggle(server)
			}, server.disabled ? "Enable" : "Disable")), (0, react.createElement)("div", { style: ui.target }, server.target), (0, react.createElement)("div", { style: ui.meta }, `from ${server.sourcePath.split("/").slice(-2).join("/")}` + (server.envKeys.length > 0 ? ` · env: ${server.envKeys.join(", ")}` : "") + (server.headerKeys.length > 0 ? ` · headers: ${server.headerKeys.join(", ")}` : "")));
		}
		function emptyGuide() {
			return (0, react.createElement)("div", { style: ui.empty }, "No MCP servers configured yet. Add one to ", (0, react.createElement)("span", { style: ui.code }, ".mcp.json"), " in your workspace, or globally to ", (0, react.createElement)("span", { style: ui.code }, "~/.config/mcp/mcp.json"), " (the same format Claude Code and Cursor read):", (0, react.createElement)("pre", { style: {
				...ui.code,
				display: "block",
				padding: "8px",
				marginTop: "6px",
				whiteSpace: "pre"
			} }, "{\n  \"mcpServers\": {\n    \"everything\": {\n      \"command\": \"npx\",\n      \"args\": [\"-y\", \"@modelcontextprotocol/server-everything\"]\n    }\n  }\n}"), "New sessions pick it up automatically. For discovery, OAuth and per-tool controls, run ", (0, react.createElement)("span", { style: ui.code }, "/mcp"), " in the composer.");
		}
		function useToggle(session, scope, patch) {
			const [note, setNote] = (0, react.useState)(void 0);
			const toggle = (server) => {
				(async () => {
					try {
						const response = await fetch("/pi2dsh/mcp-action", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({
								session,
								server: server.name,
								disabled: !server.disabled,
								scope
							})
						});
						const payload = await response.json();
						if (!response.ok) {
							setNote(String(payload.error ?? "the toggle failed"));
							return;
						}
						setNote(`${server.name} ${server.disabled ? "enabled" : "disabled"} (${scope}) — ${String(payload.note ?? "")}`);
						patch((current) => ({
							...current,
							servers: current.servers.map((entry) => entry.name === server.name ? {
								...entry,
								disabled: !server.disabled
							} : entry)
						}));
					} catch (error) {
						setNote(String(error));
					}
				})();
			};
			return {
				note,
				toggle
			};
		}
		/** The SESSION view: this session's merged config, grouped by layer. */
		function SessionMcpTab({ scope, visible }) {
			const session = scope.sessionId ?? "";
			const { state, failed, patch } = useMcpState(session, visible);
			const { note, toggle } = useToggle(session, "project", patch);
			if (failed && state === void 0) return (0, react.createElement)("div", {
				style: ui.root,
				"data-dsh-x": "mcp-tab"
			}, (0, react.createElement)("div", { style: ui.empty }, "The MCP state route is not answering — is the pi2dsh engine mounted in this profile?"));
			if (state === void 0) return (0, react.createElement)("div", {
				style: ui.root,
				"data-dsh-x": "mcp-tab"
			}, (0, react.createElement)("div", { style: ui.sub }, "Loading MCP configuration…"));
			return (0, react.createElement)("div", {
				style: ui.root,
				"data-dsh-x": "mcp-tab"
			}, (0, react.createElement)("div", { style: ui.headline }, (0, react.createElement)("span", null, "MCP servers · this session"), (0, react.createElement)("span", { style: ui.sub }, `${state.servers.length} configured`)), note === void 0 ? null : (0, react.createElement)("div", {
				style: ui.note,
				"data-dsh-x": "mcp-note"
			}, note), state.servers.length === 0 ? emptyGuide() : [["project", "This project"], ["global", "Global (all projects)"]].map(([layer, title]) => {
				const members = state.servers.filter((server) => server.layer === layer);
				if (members.length === 0) return null;
				return (0, react.createElement)("div", {
					key: layer,
					style: { display: "contents" }
				}, (0, react.createElement)("div", { style: ui.group }, title), ...members.map((server) => serverCard(server, toggle, server.disabled ? "Enable for this project" : "Disable for this project")));
			}), (0, react.createElement)("div", { style: ui.meta }, `layers: ${state.sources.length === 0 ? "none found" : state.sources.map((source) => source.split("/").slice(-2).join("/")).join(" → ")}`));
		}
		/** The GLOBAL view (Settings → MCP): cross-project layers only. */
		function SettingsMcpSection() {
			const { state, failed, patch } = useMcpState("", true);
			const { note, toggle } = useToggle("", "global", patch);
			if (failed && state === void 0) return (0, react.createElement)("div", {
				style: ui.root,
				"data-dsh-x": "mcp-settings"
			}, (0, react.createElement)("div", { style: ui.empty }, "The MCP state route is not answering — is the pi2dsh engine mounted in this profile?"));
			if (state === void 0) return (0, react.createElement)("div", {
				style: ui.root,
				"data-dsh-x": "mcp-settings"
			}, (0, react.createElement)("div", { style: ui.sub }, "Loading MCP configuration…"));
			const globals = state.servers.filter((server) => server.layer === "global");
			return (0, react.createElement)("div", {
				style: ui.root,
				"data-dsh-x": "mcp-settings"
			}, (0, react.createElement)("div", { style: ui.headline }, (0, react.createElement)("span", null, "MCP servers · global"), (0, react.createElement)("span", { style: ui.sub }, `${globals.length} configured`)), (0, react.createElement)("div", { style: ui.sub }, "Cross-project servers from your machine-level config layers. Project-level servers live in each workspace's .mcp.json and show up in the session sidebar."), note === void 0 ? null : (0, react.createElement)("div", {
				style: ui.note,
				"data-dsh-x": "mcp-note"
			}, note), globals.length === 0 ? emptyGuide() : globals.map((server) => serverCard(server, toggle, server.disabled ? "Enable everywhere" : "Disable everywhere")), (0, react.createElement)("div", { style: ui.meta }, `layers: ${state.sources.length === 0 ? "none found" : state.sources.map((source) => source.split("/").slice(-2).join("/")).join(" → ")}`));
		}
		/** Seat both views: the sidebar tab (optional) and the Settings section. */
		function registerMcpTab(ctx) {
			ctx.inject(["betterSidebar"], (scope) => {
				scope.betterSidebar?.registerTab({
					id: "dsh-work-x:mcp",
					title: "MCP",
					component: SessionMcpTab
				});
			});
			ctx.inject(["slots"], (scope) => {
				const slots = scope.slots;
				if (slots === void 0) return;
				slots.inject("settings.section", () => slots.register({
					name: "settings.section",
					id: "dsh-work-x-mcp",
					order: 60,
					label: () => "MCP"
				}, SettingsMcpSection));
			});
		}
		//#endregion
		//#region dsh-x/src/client.ts
		const inject = inject$1;
		function apply(ctx) {
			apply$1(ctx);
			registerMcpTab(ctx);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
