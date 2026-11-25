import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["tests/ts/**/*.test.{ts,tsx}"],
          exclude: ["tests/ts/web/**"],
        },
      },
      {
        plugins: [react()],
        test: {
          name: "web",
          include: ["tests/ts/web/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
    ],
  },
});
