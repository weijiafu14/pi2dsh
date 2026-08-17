// Vendored from Pi: packages/coding-agent/src/utils/open-browser.ts
// (upstream commit 6f707eb36064e82af9c1320a7634f4dfad21049b), logic unchanged.
//
// Pi's own login dialog calls this when a flow announces an authorization URL,
// which is why "A browser window should open" is in the text those flows print.
// The bridge does not run Pi's terminal dialog, so without this the sentence was
// a lie and the user was left with an unclickable wrapped URL and no way in.
import { spawn } from 'node:child_process'

/**
 * Open a URL or file in the platform browser/default handler.
 *
 * This intentionally never invokes a shell. On Windows, do not use
 * `cmd /c start`: cmd.exe re-parses metacharacters (&, |, ^, ...) before
 * `start` runs, which would make attacker-controlled URLs injectable.
 * @param target - the URL or file to hand to the platform handler.
 */
export function openBrowser(target: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [target]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', target]]
        : ['xdg-open', [target]]

  // spawn reports launcher failures (for example, missing xdg-open) via an
  // error event. Browser launch is best-effort: callers still present the target
  // to the user, so keep the launcher failure from becoming a process crash.
  spawn(cmd, args, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref()
}
