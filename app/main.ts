import OpenAI from "openai";
import fs from "fs";
import { execSync } from "child_process";
// ============================================================
// SETUP
// ============================================================
async function main() {
  let [, , flag, prompt] = process.argv;
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
  if (prompt.startsWith("/")) {
    // 1. Split the input into the skill name and the arguments
    const parts = prompt.trim().split(/\s+/);
    const skillName = parts[0].substring(1); // e.g., "apple"
    const args = parts.slice(1);             // e.g., ["staging", "eu-west"]
    
    const skillpath = `.claude/skills/${skillName}/SKILL.md`;

    if (fs.existsSync(skillpath)) {
      const readSkilldile = fs.readFileSync(skillpath, "utf-8");
      const splitFile = readSkilldile.split("---");

      if (splitFile.length >= 3) {
        const rawBody = splitFile[2].trim();
        const allArgs = args.join(" ");
        
        // 2. Substitute the placeholders in the raw body
        prompt = rawBody.replace(/\$ARGUMENTS\[(\d+)\]|\$ARGUMENTS|\$(\d+)/g, (match, idx1, idx2) => {
          if (match === "$ARGUMENTS") return allArgs;
          const index = idx1 !== undefined ? idx1 : idx2;
          return args[Number(index)] || "";
        });
      }
    }
  }
  const messages = [{ role: "user", content: prompt }];
  
  // ============================================================
  // Skill Definitions
  // ============================================================
  // ============================================================
  // Skill Definitions
  // ============================================================
  if (fs.existsSync(".claude/skills")) {
    const skillsList = fs
      .readdirSync(".claude/skills", { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((folder) => {
        const skillMDPath = `.claude/skills/${folder.name}/SKILL.md`;

        if (!fs.existsSync(skillMDPath)) return null;

        const skillMD = fs.readFileSync(skillMDPath, "utf-8");
        const parts = skillMD.split("---");

        if (parts.length < 3) return null;

        const frontmatter = parts[1];
        
        // Extract using regex
        const nameMatch = frontmatter.match(/name:\s*(.+)/);
        const descMatch = frontmatter.match(/description:\s*(.+)/);

        if (nameMatch && descMatch) {
          const skillName = nameMatch[1].trim();
          const skillDesc = descMatch[1].trim();
          return `- ${skillName}: ${skillDesc}`;
        }

        return null;
      })
      .filter(Boolean)
      .join("\n");

    if (skillsList) {
      messages.unshift({
        role: "system",
        content: `You have access to the following skills:\n\n${skillsList}`
      });
    }
  }

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
        {
          type: "function",
          function: {
            name: "Bash",
            description: "Execute a shell command",
            parameters: {
              type: "object",
              required: ["command"],
              properties: {
                command: {
                  type: "string",
                  description: "The command to execute",
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
      } else if (toolCallFunction.name === "Write") {
        const args = JSON.parse(toolCallFunction.arguments);
        fs.writeFileSync(args.file_path, args.content);

        messages.push({
          role: "tool",
          tool_call_id: message.tool_calls[0].id,
          content: `File ${args.file_path} written successfully.`,
        });
      } else if (toolCallFunction.name === "Bash") {
        const args = JSON.parse(toolCallFunction.arguments);

        const output = execSync(args.command, { encoding: "utf-8" });

        messages.push({
          role: "tool",
          tool_call_id: message.tool_calls[0].id,
          content: output,
        });
      }

    } else {
      console.log(message.content);
      break;
    }
  }
}

main();

