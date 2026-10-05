// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { Daemon } from '../../src/daemon';
import { DEFAULT_SETTINGS } from '../../src/settings';

// A child of the runner that asks the language server one question and prints
// the answer: the compiler's own words for a request, taken outside the editor,
// so a check can hold what the editor shows against them.
//
//   node reference-answer.js <binary> <workspace-root> <method> <params-json> [--build-on-inspect] [--first <requests-json>] [--published]
//
// It speaks through the extension's own client, so the request reaches the
// server framed and initialised exactly as the extension's does, and it is run by
// the runner with the scenario's contained environment, which it passes on to
// the server it starts. It prints one JSON line — the result, or the error the
// server answered with — and exits.
//
// --published adds, under `published`, every finding list the server published
// from the moment the asked request was sent until it was answered, each as the
// server sent it: the document it names and its entries. A finding the server
// publishes rather than answers — a build's, among them a refusal raised while
// rendering — is then held against the server's own words, position and codes as
// well as the answer is. The client files a publication as it reads it, before the
// answer that follows it, so one sent ahead of the answer is among them.
//
// --first names requests, as a JSON array of { method, params }, sent to the
// same server before the one asked. Their answers are not printed; one that is
// refused ends the child with that refusal named, since the answer asked for
// would then be about a server in a state the caller did not set up.
//
// The handshake is the one request the client makes by itself, as it starts, so
// it is not sent a second time: asked for it, the child answers with what the
// server said in the handshake it has just had, as the client read it.

const HANDSHAKE = 'aggrega/initialize';

// PUBLICATION is the notification a finding list is published on.
const PUBLICATION = 'aggrega/publishDiagnostics';

// The client gives the server's handshake a bound of its own, which a busy
// machine can outrun with a server that is starting correctly. A start that ran
// out on that bound is made again, at most START_ATTEMPTS times in all, so the
// answer a check reads does not depend on how busy the machine was.
const START_ATTEMPTS = 3;
const HANDSHAKE_RAN_OUT = 'initialize timeout';

async function start(daemon: Daemon, root: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await daemon.start(root);
      return;
    } catch (err) {
      if (attempt >= START_ATTEMPTS || !(err instanceof Error) || err.message !== HANDSHAKE_RAN_OUT) { throw err; }
      await daemon.stop().catch(() => undefined);
    }
  }
}

async function main(): Promise<void> {
  const [binary, root, method, paramsJson, ...flags] = process.argv.slice(2);
  const at = flags.indexOf('--first');
  const first = at === -1 ? [] : JSON.parse(flags[at + 1] ?? '[]') as { method: string; params: unknown }[];
  const daemon = new Daemon({ ...DEFAULT_SETTINGS, binaryPath: binary, buildOnInspect: flags.includes('--build-on-inspect'), respawnAttempts: 0 });
  const published: unknown[] = [];
  let recording = false;
  daemon.on(`notification:${PUBLICATION}`, (params: unknown) => {
    if (recording) { published.push(params); }
  });
  let out: Record<string, unknown>;
  try {
    await start(daemon, root);
    for (const r of first) {
      await daemon.request(r.method as never, r.params).catch((err: unknown) => {
        throw new Error(`the request sent first, ${r.method}, was refused: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    recording = true;
    const result = method === HANDSHAKE ? daemon.getServerInitMetadata() : await daemon.request(method as never, JSON.parse(paramsJson));
    out = { ok: true, result };
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown; data?: unknown };
    out = { ok: false, error: { code: e.code ?? null, message: typeof e.message === 'string' ? e.message : String(err), data: e.data ?? null } };
  }
  recording = false;
  if (flags.includes('--published')) { out.published = published; }
  await daemon.stop().catch(() => undefined);
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

main().then(() => process.exit(0), (err: unknown) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code: null, message: err instanceof Error ? err.message : String(err), data: null } })}\n`);
  process.exit(0);
});
