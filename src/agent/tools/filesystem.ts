/**
 * Filesystem tools with workspace confinement.
 */

import { join, resolve } from "@std/path";
import type { Tool } from "./base.ts";

function assertWithinWorkspace(workspace: string, filePath: string): string {
  // Resolve both paths to absolute without requiring the path to exist yet.
  // For paths that don't exist we resolve the parent and reattach the basename.
  const abs = resolve(workspace, filePath);
  const realWorkspace = (() => {
    try {
      return Deno.realPathSync(workspace);
    } catch {
      return resolve(workspace);
    }
  })();
  const realAbs = (() => {
    try {
      return Deno.realPathSync(abs);
    } catch {
      // Path doesn't exist yet — resolve the nearest existing ancestor.
      return abs;
    }
  })();
  if (!realAbs.startsWith(realWorkspace + "/") && realAbs !== realWorkspace) {
    throw new Error(
      `Path "${filePath}" is outside the workspace "${workspace}".`,
    );
  }
  return realAbs;
}

export class ReadFileTool implements Tool {
  name = "read_file";
  description = "Read the contents of a file within the workspace.";
  parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file (relative to workspace or absolute within workspace)." },
    },
    required: ["path"],
  };

  constructor(private workspace: string) {}

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = String(args.path);
    const safe = assertWithinWorkspace(this.workspace, filePath);
    const content = await Deno.readTextFile(safe);
    return content;
  }
}

export class WriteFileTool implements Tool {
  name = "write_file";
  description = "Write content to a file within the workspace, creating parent directories as needed.";
  parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file." },
      content: { type: "string", description: "Content to write." },
    },
    required: ["path", "content"],
  };

  constructor(private workspace: string) {}

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = String(args.path);
    const content = String(args.content);
    // Compute the absolute path before asserting so we can create parent dirs.
    const abs = resolve(this.workspace, filePath);
    const realWorkspace = (() => {
      try {
        return Deno.realPathSync(this.workspace);
      } catch {
        return resolve(this.workspace);
      }
    })();
    if (!abs.startsWith(realWorkspace + "/") && abs !== realWorkspace) {
      throw new Error(
        `Path "${filePath}" is outside the workspace "${this.workspace}".`,
      );
    }
    const parent = abs.substring(0, abs.lastIndexOf("/"));
    await Deno.mkdir(parent, { recursive: true });
    await Deno.writeTextFile(abs, content);
    return `Written ${content.length} bytes to ${filePath}.`;
  }
}

export class EditFileTool implements Tool {
  name = "edit_file";
  description = "Replace a specific string in a file within the workspace.";
  parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the file." },
      old_text: { type: "string", description: "Exact text to replace." },
      new_text: { type: "string", description: "Replacement text." },
    },
    required: ["path", "old_text", "new_text"],
  };

  constructor(private workspace: string) {}

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = String(args.path);
    const oldText = String(args.old_text);
    const newText = String(args.new_text);
    const safe = assertWithinWorkspace(this.workspace, filePath);
    const original = await Deno.readTextFile(safe);
    if (!original.includes(oldText)) {
      throw new Error(`old_text not found in "${filePath}".`);
    }
    const count = original.split(oldText).length - 1;
    if (count > 1) {
      return `old_text appears ${count} times in "${filePath}". Provide more context to make it unique.`;
    }
    const updated = original.replace(oldText, newText);
    await Deno.writeTextFile(safe, updated);
    return `Edited "${filePath}" successfully.`;
  }
}

export class ListDirTool implements Tool {
  name = "list_dir";
  description = "List the contents of a directory within the workspace.";
  parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path (defaults to workspace root)." },
    },
    required: [],
  };

  constructor(private workspace: string) {}

  async execute(args: Record<string, unknown>): Promise<string> {
    const dirPath = args.path ? String(args.path) : ".";
    const safe = assertWithinWorkspace(this.workspace, dirPath);
    const entries: string[] = [];
    for await (const entry of Deno.readDir(safe)) {
      const suffix = entry.isDirectory ? "/" : entry.isSymlink ? "@" : "";
      entries.push(entry.name + suffix);
    }
    entries.sort();
    return entries.join("\n");
  }
}
