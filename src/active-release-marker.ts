// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { describeError } from './error-text';
import type { SetActiveReleaseParams } from './types';
import { ACTIVE_RELEASE_MARKER_BASENAME, AGGREGA_DIR } from './workspace';

// This module decides what recording the selected Release as the workspace's
// default asks of the language server, and the sentence the action ends in. It
// reaches no editor type, so the whole decision is driven by a test; the command
// that runs it only shows the ending.
//
// 🔴 THE EXTENSION WRITES NO MARKER. The language server writes it, holding the
// marker and the directory it sits in to the workspace by the one judgement every
// write the product performs there is held to: where the `.aggrega` directory or
// the marker is a link leading out of the workspace, whether or not the place it
// leads to exists yet, the write is refused with nothing written, in the
// compiler's own words. A write
// performed here would be a second judgement of where a path leads, and the
// extension's own reading of a path is its spelling alone.

// RecordsActiveRelease is the request that records a Release as the workspace's
// default. It rejects where no language server is running, and with the server's
// refusal where the write is refused.
export type RecordsActiveRelease = (params: SetActiveReleaseParams) => Promise<unknown>;

// MarkerEnding is the one notification the action ends in, and whether it reports
// a failure.
export interface MarkerEnding {
  failed: boolean;
  message: string;
}

// recordActiveRelease asks the language server to record selectedRelease, the
// workspace-relative Release the editor is acting on, and answers with the ending.
//
// It prompts for nothing and detects nothing: the editor already holds the
// reader's answer, and a prompt here would be a second way to choose a Release.
// With no Release selected nothing is asked, and the ending says so.
//
// The language server answers with the Release the workspace settles on once the
// marker is written, and the answer is not read here. Recording a default changes
// nothing about the session in progress — the selection already travels on every
// request — so it records the choice for the next session and leaves this one
// where it is. A refusal, or a failure to reach the server at all, ends in the
// words it arrived with, never reworded.
export async function recordActiveRelease(
  record: RecordsActiveRelease,
  selectedRelease: string | null,
): Promise<MarkerEnding> {
  if (!selectedRelease) {
    return {
      failed: false,
      message: 'Aggrega: no Release is selected, so there is none to set as this workspace default. Select one first.',
    };
  }
  try {
    await record({ release: selectedRelease });
  } catch (err) {
    return {
      failed: true,
      message: `Aggrega: could not write ${AGGREGA_DIR}/${ACTIVE_RELEASE_MARKER_BASENAME}: ${describeError(err)}`,
    };
  }
  return {
    failed: false,
    message: `Aggrega: ${selectedRelease} is now this workspace's default Release.`,
  };
}
