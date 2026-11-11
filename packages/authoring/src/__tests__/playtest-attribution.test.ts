import { FAULT_ORIGINS, GameRuntimeError, IllegalActionError, StepBudgetExceededError } from "@chaincraft/runtime";
import type { FaultCode } from "@chaincraft/runtime";
import { ExpressionError } from "@chaincraft/compiler";
import { attributeError, UNCLASSIFIED } from "../tools/playtest/attribution.js";

const fault = (code: FaultCode) => new GameRuntimeError(code, "boom");

describe("attributeError", () => {
  it.each<[string, unknown, string, string]>([
    ["step budget", new StepBudgetExceededError(10, "loop-1"), "playtest-runaway", "spec"],
    ["no legal actions", fault("no-legal-actions"), "playtest-no-legal-actions", "spec"],
    ["other spec fault", fault("player-target-no-actor"), "playtest-spec-error", "spec"],
    ["custom handler", fault("no-custom-handler"), "playtest-unsupported", "unsupported"],
    ["system responder", fault("no-system-responder"), "playtest-unsupported", "unsupported"],
    ["controller misuse", fault("no-pending-prompt"), "engine-error", "engine"],
    ["engine fault", fault("walk-mismatch"), "engine-error", "engine"],
    ["illegal action", new IllegalActionError("rejected", 0), "engine-error", "engine"],
    ["runtime expression fault", new ExpressionError("Cannot resolve \"actor\"", 0, undefined, "expression-no-actor"), "playtest-spec-error", "spec"],
    ["unbound expression root", new ExpressionError("\"player\" requires boundPlayerId", 0, undefined, "expression-unbound-root"), "engine-error", "engine"],
  ])("%s", (_label, error, code, category) => {
    expect(attributeError(error)).toMatchObject({ code, category });
  });

  it("carries the runtime fault code", () => {
    expect(attributeError(fault("inventory-no-room")).faultCode).toBe("inventory-no-room");
  });

  it("recognizes a fault from another copy of the runtime by structure", () => {
    const copy = Object.assign(new Error("boom"), { code: "action-unknown", origin: "spec" });
    expect(attributeError(copy)).toMatchObject({ code: "playtest-spec-error", faultCode: "action-unknown" });
  });

  it.each([[new TypeError("Cannot read properties of undefined")], ["thrown string"], [undefined]])(
    "falls back to unclassified for %p",
    (error) => {
      expect(attributeError(error)).toBe(UNCLASSIFIED);
    },
  );

  it("gives every spec fault a hint", () => {
    const specCodes = (Object.keys(FAULT_ORIGINS) as FaultCode[]).filter((c) => FAULT_ORIGINS[c] === "spec");
    for (const code of specCodes) {
      expect(attributeError(fault(code)).hint.length).toBeGreaterThan(0);
    }
  });
});
