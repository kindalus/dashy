import { expect, test } from "bun:test";
import {
  cornerStyles,
  resolveTheme,
  themeNames,
  type ThemeConfig,
} from "../core/theme";
import { defineProject } from "../core/project";
import { DashyEngine } from "../core/engine";
import { createApiHandler } from "../core/http";
import empty from "../dashy.config";

test("legacy projects default to Excel with square controls", () => {
  expect(resolveTheme()).toEqual({
    name: "excel",
    corners: { inputs: "none", buttons: "none", panels: "none" },
  });
});

test("each theme has defaults and accepts a shared style for all control families", () => {
  const defaults = [
    "none",
    "rounded",
    "rounded-lg",
    "rounded-sm",
    "rounded-md",
  ] as const;
  for (const [index, name] of themeNames.entries()) {
    expect(resolveTheme({ name }).corners).toEqual({
      inputs: defaults[index]!,
      buttons: defaults[index]!,
      panels: defaults[index]!,
    });
    for (const corners of cornerStyles)
      expect(resolveTheme({ name, corners })).toEqual({
        name,
        corners: { inputs: corners, buttons: corners, panels: corners },
      });
  }
});

test("independent corner overrides preserve theme defaults for unspecified controls", () => {
  const config: ThemeConfig = {
    name: "chromeos",
    corners: { inputs: "none", panels: "rounded-lg" },
  };
  expect(resolveTheme(config)).toEqual({
    name: "chromeos",
    corners: { inputs: "none", buttons: "rounded", panels: "rounded-lg" },
  });
  expect(config.corners).toEqual({ inputs: "none", panels: "rounded-lg" });
});

test("rejects malformed theme names, unknown properties and invalid corner values at startup", () => {
  for (const theme of [
    null,
    "excel",
    [],
    { name: "unknown" },
    { name: "constructor" },
    { name: null },
    { colour: "red" },
    { corners: "rouded-md" },
    { corners: [] },
    { corners: null },
    { corners: { button: "rounded" } },
    { corners: { buttons: null } },
    { corners: { panels: 10 } },
  ]) {
    expect(() =>
      defineProject({ ...empty, theme: theme as unknown as ThemeConfig }),
    ).toThrow("Invalid Dashy theme");
  }
});

test("catalog API includes the resolved theme used by SSR and hydration", async () => {
  const engine = new DashyEngine({
    ...empty,
    theme: { name: "macos", corners: { buttons: "rounded" } },
  });
  const handler = createApiHandler(engine);
  const response = await handler(new Request("http://localhost/api/catalog"));
  expect(response.status).toBe(200);
  expect((await response.json()).theme).toEqual({
    name: "macos",
    corners: { inputs: "rounded-md", buttons: "rounded", panels: "rounded-md" },
  });
});
