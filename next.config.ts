import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Query embedding runs onnxruntime-web (WebAssembly) in the route handler; keep it a
  // plain Node require so it finds its .wasm next to its own files.
  serverExternalPackages: ["onnxruntime-web"],
  // The corpus, vectors and embedding model are read with fs at runtime; ship them with the functions.
  outputFileTracingIncludes: {
    "/api/**": [
      "./data/index/**",
      "./data/knowledge/**",
      "./data/model/**",
      "./node_modules/onnxruntime-web/dist/ort.node.min.mjs",
      "./node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs",
      "./node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
    ],
    // Preview-only evaluation runner reads the test cases.
    "/api/eval-run": ["./tests/minwon.json"],
  },
};

export default nextConfig;
