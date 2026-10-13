import OpenAI from "openai";
import fs from "fs";

// ============================================================
// SETUP
// ============================================================
async function main() {
  const [, , flag, prompt] = process.argv;
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseURL =
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }
  if (flag !== "-p" || !prompt) {
    throw new Error("error: -p flag is required");
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
  });

  // ============================================================
  // STATE
  // ============================================================
  const messages = [{ role: "user", content: prompt }];

  // ============================================================
  // AGENT LOOP
  // ============================================================
  while (true) {
    const response = await client.chat.completions.create({
      model: "anthropic/claude-haiku-4.5",
      messages,
      tools: [
        {
          type: "function",
          function: {
            name: "Read",
            description: "Read and return the contents of a file",
            parameters: {
              type: "object",
              properties: {
                file_path: {
                  type: "string",
                  description: "The path to the file to read",
                },
              },
              required: ["file_path"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "Write",
            description: "Write content to a file",
            parameters: {
              type: "object",
              required: ["file_path", "content"],
              properties: {
                file_path: {
                  type: "string",
                  description: "The path of the file to write to",
                },
                content: {
                  type: "string",
                  description: "The content to write to the file",
                },
              },
            },
          },
        },
      ],
    });

    if (!response.choices || response.choices.length === 0) {
      throw new Error("no choices in response");
    }

    // ============================================================
    // RESPONSE HANDLING
    // ============================================================
    const message = response.choices[0].message;
    messages.push(message);

    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCallFunction = message.tool_calls[0].function;

      if (toolCallFunction.name === "Read") {
        const args = JSON.parse(toolCallFunction.arguments);
        const fileContent = fs.readFileSync(args.file_path, "utf-8");

        messages.push({
          role: "tool",
          tool_call_id: message.tool_calls[0].id,
          content: fileContent,
        });
      }else if (toolCallFunction.name === "Write"){
        const args = JSON.parse(toolCallFunction.arguments);
        fs.writeFileSync(args.file_path, args.content);

        messages.push({
          role: "tool",
          tool_call_id: message.tool_calls[0].id,
          content: `File ${args.file_path} written successfully.`
        })
      }


    } else {
      console.log(message.content);
      break;
    }
  }
}

main();
