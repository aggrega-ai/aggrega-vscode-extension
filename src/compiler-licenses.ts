// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { describeError } from './error-text';
import * as l10n from './l10n';
import { SpawnFn } from './version-check';

// This module shows the third-party notices of the compiler the reader runs: the
// text `aggrega version --licenses` prints, in an unsaved buffer. The editor asks
// the same binary the command line would, so the two show the same notices for
// the same compiler. It reaches no editor type: the compiler is run through a
// seam handed in, and so are the opening of the text and the error message.

// SHOW_COMPILER_LICENSES_COMMAND is the command that shows the notices.
export const SHOW_COMPILER_LICENSES_COMMAND = 'aggrega.compiler.showLicenses';

// CompilerLicensesDeps is what showCompilerLicenses reaches into: the compiler to
// ask, the seam that runs it, the opening of a document and the error message.
export interface CompilerLicensesDeps {
  binaryPath: string;
  run: SpawnFn;
  open(content: string, language: string): Promise<void>;
  showError(message: string): void;
}

// showCompilerLicenses opens what the configured compiler prints for
// `version --licenses`, unchanged, as plain text. Where the compiler cannot be run
// or exits with a failure, it says which compiler and the first line of the
// failure, and opens nothing.
export async function showCompilerLicenses(deps: CompilerLicensesDeps): Promise<void> {
  let notices: string;
  try {
    notices = await deps.run(deps.binaryPath, ['version', '--licenses']);
  } catch (err) {
    // The runtime's report of a failed run carries what the program printed on
    // lines of its own; its first line is what fits inside one message.
    const firstLine = describeError(err).split('\n')[0].trim();
    deps.showError(l10n.t('Aggrega: could not read the third-party licenses from the compiler at {0}: {1}', deps.binaryPath, firstLine));
    return;
  }
  await deps.open(notices, 'plaintext');
}
