import { Tokenizer } from "@huggingface/tokenizers";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const cache = new Map<string, Tokenizer>();
export function countTokens(text: string, model = "deepseek-flash"): number {
  const name = model.includes("pro") ? "pro" : "flash";
  let tokenizer = cache.get(name);
  if (!tokenizer) {
    const root =
      typeof __dirname !== "undefined"
        ? join(__dirname, "..", "resources", "tokenizers")
        : join(process.cwd(), "resources", "tokenizers");
    const file = join(root, name + ".json");
    if (!existsSync(file))
      throw new Error("离线 tokenizer 数据缺失，请重新安装应用");
    tokenizer = new Tokenizer(JSON.parse(readFileSync(file, "utf8")), {
      tokenizer_class: "PreTrainedTokenizer",
      bos_token: "<｜begin▁of▁sentence｜>",
      eos_token: "<｜end▁of▁sentence｜>",
    });
    cache.set(name, tokenizer);
  }
  return Math.ceil(tokenizer.encode(text).ids.length * 1.15) + 128;
}
