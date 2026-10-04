# Bundled official DeepSeek tokenizers

Downloaded 2026-10-04 from DeepSeek's official recipe repository. Distributed under the accompanying MIT license.

- Flash: https://github.com/deepseek-ai/deepseek-recipe/blob/main/static/tokenizers/v41/tokenizer.json
  SHA-256: `81f64d1248a68ce3663e07ab3ee48b851e5df0e32d27cb98e4c9a268151e8d99`
- Pro: https://github.com/deepseek-ai/deepseek-recipe/blob/main/static/tokenizers/v4/tokenizer.json
  SHA-256: `97d2f31b020d18b5aee5c9b3d5b4efb10ea210f3fe3f7dffe3f1cd90542d6b19`

`electron/token-count.ts` runs these data offline through `@huggingface/tokenizers`, includes the schema and instructions, and reserves 15% plus 128 tokens for framing and tokenizer runtime differences. Estimates are capacity checks; returned provider usage is authoritative. Missing usage is explicitly estimated.
