import test from "node:test";
import assert from "node:assert/strict";
import { policyModel, strongOnly, withStrongModels, STRONG_MODELS } from "../lib/llm.ts";

test("evaluation policy: inside strong mode a lite model maps to a strong one; outside nothing changes", async () => {
  assert.equal(strongOnly(), false);
  assert.equal(policyModel("gemini-flash-lite-latest"), "gemini-flash-lite-latest");
  await withStrongModels(true, async () => {
    await new Promise(r => setTimeout(r, 1));
    assert.equal(strongOnly(), true);
    assert.equal(policyModel("gemini-3.1-flash-lite"), STRONG_MODELS[0]);
    assert.equal(policyModel("gemini-pro-latest"), "gemini-pro-latest");
  });
  assert.equal(strongOnly(), false);
});
