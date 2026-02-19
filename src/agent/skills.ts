/**
 * Skills loader for agent capabilities.
 *
 * Skills are markdown files (SKILL.md) that teach the agent how to use
 * specific tools or perform certain tasks. All skills live in
 * {workspace}/skills/ and can be modified by users or created by the agent.
 */

import { join } from "@std/path";

export interface SkillInfo {
  name: string;
  path: string;
}

export interface SkillMetadata {
  [key: string]: string;
}

interface ContainerClawMetadata {
  requires?: { bins?: string[]; env?: string[] };
  always?: boolean;
  emoji?: string;
  [key: string]: unknown;
}

export class SkillsLoader {
  private skillsDir: string;
  private defaultSkillsDir: string;

  constructor(workspace: string, defaultSkillsDir?: string) {
    this.skillsDir = join(workspace, "skills");
    this.defaultSkillsDir = defaultSkillsDir ??
      join(import.meta.dirname!, "..", "skills");
  }

  /**
   * Seed default skills into workspace. Skips skills that already exist
   * (preserves user modifications). Idempotent.
   */
  async seedDefaultSkills(): Promise<void> {
    await Deno.mkdir(this.skillsDir, { recursive: true });
    try {
      for await (const entry of Deno.readDir(this.defaultSkillsDir)) {
        if (!entry.isDirectory) continue;
        const targetDir = join(this.skillsDir, entry.name);
        try {
          await Deno.stat(targetDir);
          continue; // Already exists — don't overwrite
        } catch {
          await this.copyDir(
            join(this.defaultSkillsDir, entry.name),
            targetDir,
          );
        }
      }
    } catch {
      // Default skills dir doesn't exist (e.g., in tests) — that's fine
    }
  }

  /**
   * List all skills in the workspace.
   */
  async listSkills(filterUnavailable = true): Promise<SkillInfo[]> {
    const skills: SkillInfo[] = [];
    try {
      for await (const entry of Deno.readDir(this.skillsDir)) {
        if (!entry.isDirectory) continue;
        const skillFile = join(this.skillsDir, entry.name, "SKILL.md");
        try {
          await Deno.stat(skillFile);
          skills.push({ name: entry.name, path: skillFile });
        } catch {
          // No SKILL.md, skip
        }
      }
    } catch {
      // Skills dir doesn't exist
      return [];
    }

    if (!filterUnavailable) return skills;

    const available: SkillInfo[] = [];
    for (const s of skills) {
      const meta = await this.getSkillMeta(s.name);
      if (await this.checkRequirements(meta)) {
        available.push(s);
      }
    }
    return available;
  }

  /**
   * Load a skill's content by name.
   */
  async loadSkill(name: string): Promise<string | null> {
    const skillFile = join(this.skillsDir, name, "SKILL.md");
    try {
      return await Deno.readTextFile(skillFile);
    } catch {
      return null;
    }
  }

  /**
   * Load specific skills formatted for inclusion in agent context.
   * Strips frontmatter and wraps each skill with a header.
   */
  async loadSkillsForContext(skillNames: string[]): Promise<string> {
    const parts: string[] = [];
    for (const name of skillNames) {
      const content = await this.loadSkill(name);
      if (content) {
        const stripped = this.stripFrontmatter(content);
        parts.push(`### Skill: ${name}\n\n${stripped}`);
      }
    }
    return parts.length > 0 ? parts.join("\n\n---\n\n") : "";
  }

  /**
   * Build an XML summary of all skills for progressive loading.
   * The agent reads the full SKILL.md via read_file when needed.
   */
  async buildSkillsSummary(): Promise<string> {
    const allSkills = await this.listSkills(false);
    if (allSkills.length === 0) return "";

    const escapeXml = (s: string): string =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const lines: string[] = ["<skills>"];
    for (const s of allSkills) {
      const name = escapeXml(s.name);
      const desc = escapeXml(await this.getSkillDescription(s.name));
      const meta = await this.getSkillMeta(s.name);
      const available = await this.checkRequirements(meta);

      lines.push(`  <skill available="${String(available)}">`);
      lines.push(`    <name>${name}</name>`);
      lines.push(`    <description>${desc}</description>`);
      lines.push(`    <location>${s.path}</location>`);

      if (!available) {
        const missing = await this.getMissingRequirements(meta);
        if (missing) {
          lines.push(`    <requires>${escapeXml(missing)}</requires>`);
        }
      }

      lines.push(`  </skill>`);
    }
    lines.push("</skills>");
    return lines.join("\n");
  }

  /**
   * Get skills marked as always-loaded that meet requirements.
   */
  async getAlwaysSkills(): Promise<string[]> {
    const result: string[] = [];
    const skills = await this.listSkills(true);
    for (const s of skills) {
      const frontmatter = await this.getSkillMetadata(s.name);
      if (!frontmatter) continue;
      const containerClawMeta = this.parseContainerClawMetadata(
        frontmatter["metadata"] ?? "",
      );
      if (containerClawMeta.always || frontmatter["always"] === "true") {
        result.push(s.name);
      }
    }
    return result;
  }

  /**
   * Parse YAML frontmatter from a skill's SKILL.md.
   */
  async getSkillMetadata(name: string): Promise<SkillMetadata | null> {
    const content = await this.loadSkill(name);
    if (!content) return null;

    if (!content.startsWith("---")) return null;

    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const metadata: SkillMetadata = {};
    for (const line of match[1].split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
      metadata[key] = value;
    }
    return metadata;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private stripFrontmatter(content: string): string {
    if (!content.startsWith("---")) return content;
    const match = content.match(/^---\n[\s\S]*?\n---\n/);
    if (match) return content.slice(match[0].length).trim();
    return content;
  }

  private parseContainerClawMetadata(raw: string): ContainerClawMetadata {
    try {
      const data = JSON.parse(raw);
      if (typeof data === "object" && data !== null) {
        return data.containerclaw ?? data.nanobot ?? data.openclaw ?? {};
      }
      return {};
    } catch {
      return {};
    }
  }

  private async checkRequirements(meta: ContainerClawMetadata): Promise<boolean> {
    const requires = meta.requires;
    if (!requires) return true;

    for (const bin of requires.bins ?? []) {
      if (!(await this.whichExists(bin))) return false;
    }
    for (const env of requires.env ?? []) {
      if (!Deno.env.get(env)) return false;
    }
    return true;
  }

  private async getMissingRequirements(meta: ContainerClawMetadata): Promise<string> {
    const missing: string[] = [];
    const requires = meta.requires;
    if (!requires) return "";

    for (const bin of requires.bins ?? []) {
      if (!(await this.whichExists(bin))) missing.push(`CLI: ${bin}`);
    }
    for (const env of requires.env ?? []) {
      if (!Deno.env.get(env)) missing.push(`ENV: ${env}`);
    }
    return missing.join(", ");
  }

  private async getSkillDescription(name: string): Promise<string> {
    const meta = await this.getSkillMetadata(name);
    if (meta?.["description"]) return meta["description"];
    return name;
  }

  private async getSkillMeta(name: string): Promise<ContainerClawMetadata> {
    const meta = await this.getSkillMetadata(name);
    if (!meta) return {};
    return this.parseContainerClawMetadata(meta["metadata"] ?? "");
  }

  private async whichExists(bin: string): Promise<boolean> {
    try {
      const cmd = new Deno.Command("which", {
        args: [bin],
        stdout: "null",
        stderr: "null",
      });
      const status = await cmd.output();
      return status.success;
    } catch {
      return false;
    }
  }

  private async copyDir(src: string, dest: string): Promise<void> {
    await Deno.mkdir(dest, { recursive: true });
    for await (const entry of Deno.readDir(src)) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      if (entry.isDirectory) {
        await this.copyDir(srcPath, destPath);
      } else {
        await Deno.copyFile(srcPath, destPath);
      }
    }
  }
}
