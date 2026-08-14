// @ts-nocheck — vendored Pi source excerpt (pi-coding-agent core/provider-composer.js adaptOAuth @0.84.1, MIT, see ./PI-LICENSE); logic unchanged.
// The official two-generation adapter: extension oauth callbacks (onAuth/onDeviceCode/onPrompt/onSelect)
// over the pi-ai interaction surface (prompt/notify/signal), plus refresh and toAuth->getApiKey.
export function adaptOAuth(config) {
    return {
        name: config.name,
        isSubscription: config.isSubscription,
        login: async (callbacks) => {
            const credential = await config.login({
                onAuth: (info) => callbacks.notify({ type: "auth_url", ...info }),
                onDeviceCode: (info) => callbacks.notify({ type: "device_code", ...info }),
                onPrompt: (prompt) => callbacks.prompt({ type: "text", ...prompt }),
                onProgress: (message) => callbacks.notify({ type: "progress", message }),
                onManualCodeInput: () => callbacks.prompt({ type: "manual_code", message: "Paste the authorization code" }),
                onSelect: (prompt) => callbacks.prompt({ type: "select", ...prompt }),
                signal: callbacks.signal,
            });
            return { ...credential, type: "oauth" };
        },
        refresh: async (credential, signal) => ({ ...(await config.refreshToken(credential, signal)), type: "oauth" }),
        toAuth: async (credential) => ({ apiKey: config.getApiKey(credential) }),
    };
}
