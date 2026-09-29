// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { Daemon } from '../../src/daemon';
import { DEFAULT_SETTINGS } from '../../src/settings';

// A child of the runner that asks the language server one question and prints
// the answer: the compiler's own words for a request, taken outside the editor,
// so a check can hold what the editor shows against them.
//
//   node reference-answer.js <binary> <workspace-root> <method> <params-json> [--build-on-inspect]
//
// It speaks through the extension's own client, so the request reaches the
// server framed and initialised exactly as the extension's does, and it is run by
// the runner with the scenario's contained environment, which it passes on to
// the server it starts. It prints one JSON line — the result, or the error the
// server answered with — and exits.
//
// The handshake is the one request the client makes by itself, as it starts, so
// it is not sent a second time: asked for it, the child answers with what the
// server said in the handshake it has just had, as the client read it.

const HANDSHAKE = 'aggrega/initialize';

async function main(): Promise<void> {
  const [binary, root, method, paramsJson, flag] = process.argv.slice(2);
  const daemon = new Daemon({ ...DEFAULT_SETTINGS, binaryPath: binary, buildOnInspect: flag === '--build-on-inspect', respawnAttempts: 0 });
  let out: unknown;
  try {
    await daemon.start(root);
    const result = method === HANDSHAKE ? daemon.getServerInitMetadata() : await daemon.request(method as never, JSON.parse(paramsJson));
    out = { ok: true, result };
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown; data?: unknown };
    out = { ok: false, error: { code: e.code ?? null, message: typeof e.message === 'string' ? e.message : String(err), data: e.data ?? null } };
  }
  await daemon.stop().catch(() => undefined);
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

main().then(() => process.exit(0), (err: unknown) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code: null, message: err instanceof Error ? err.message : String(err), data: null } })}\n`);
  process.exit(0);
});
