// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

// DaemonState is the lifecycle position of the Daemon subprocess.
// Request dispatch consults state to decide whether to dispatch
// directly, queue for later drain, or reject the request.
//
// It is declared apart from the client that moves it so that a surface
// describing a position — what the status bar or a list panel says about it —
// can name the positions without reaching the code that starts a process.
export enum DaemonState {
  Stopped = 'Stopped',
  Starting = 'Starting',
  Running = 'Running',
  Restarting = 'Restarting',
  Stopping = 'Stopping',
}
