// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license

/**
 * License minting primitives. Lives under scripts/lib/ (not server/lib/)
 * because this module runs in GitHub Action VMs and future Phase 2 Node
 * contexts — it never loads as part of the running Express server.
 *
 * See: docs/specs/2026-04-11-license-mint-automation-design.md
 */

/** Base class so `instanceof Error` + step-level matching both work. */
class MinterError extends Error {
  constructor(message, step) {
    super(message)
    this.name = this.constructor.name
    this.step = step
  }
}

export class InputValidationError extends MinterError {
  constructor(message) { super(message, 'validate') }
}

export class MintError extends MinterError {
  constructor(message) { super(message, 'mint') }
}

export class DeliveryError extends MinterError {
  constructor(message, { lid } = {}) {
    super(message, 'deliver')
    this.lid = lid
  }
}

export class AuditWriteError extends MinterError {
  constructor(message, { lastSha } = {}) {
    super(message, 'audit')
    this.lastSha = lastSha
  }
}
