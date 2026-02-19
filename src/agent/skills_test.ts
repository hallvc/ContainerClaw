import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { SkillsLoader } from "./skills.ts";

/** Helper: create a skill directory with SKILL.md in the given base dir. */
async function createSkill(
  baseDir: string,
  name: string,
  frontmatter: string,
  body: string,
): Promise<void> {
  const skillDir = join(baseDir, "skills", name);
  await Deno.mkdir(skillDir, { recursive: true });
  await Deno.writeTextFile(
    join(skillDir, "SKILL.md"),
    `---\n${frontmatter}\n---\n\n${body}`,
  );
}

// ---------------------------------------------------------------------------
// listSkills
// ---------------------------------------------------------------------------

Deno.test("SkillsLoader - listSkills returns empty array when no skills dir", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const loader = new SkillsLoader(dir, dir); // no default skills either
    const skills = await loader.listSkills();
    assertEquals(skills, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("SkillsLoader - listSkills discovers workspace skills", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createSkill(dir, "test-skill", 'name: test-skill\ndescription: "A test"', "# Test");
    const loader = new SkillsLoader(dir, dir);
    const skills = await loader.listSkills(false);
    assertEquals(skills.length, 1);
    assertEquals(skills[0].name, "test-skill");
    assertStringIncludes(skills[0].path, "test-skill/SKILL.md");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("SkillsLoader - listSkills filters unavailable skills by default", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createSkill(
      dir,
      "needs-bin",
      'name: needs-bin\ndescription: "Needs a binary"\nmetadata: {"containerclaw":{"requires":{"bins":["nonexistent_binary_xyz_12345"]}}}',
      "# Needs bin",
    );
    await createSkill(dir, "no-reqs", 'name: no-reqs\ndescription: "No requirements"', "# OK");
    const loader = new SkillsLoader(dir, dir);

    const filtered = await loader.listSkills(); // filterUnavailable=true (default)
    assertEquals(filtered.length, 1);
    assertEquals(filtered[0].name, "no-reqs");

    const all = await loader.listSkills(false);
    assertEquals(all.length, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("SkillsLoader - listSkills skips directories without SKILL.md", async () => {
  const dir = await Deno.makeTempDir();
  try {
    // Create a directory without SKILL.md
    await Deno.mkdir(join(dir, "skills", "empty-dir"), { recursive: true });
    // Create a valid skill
    await createSkill(dir, "valid", 'name: valid\ndescription: "Valid"', "# Valid");
    const loader = new SkillsLoader(dir, dir);
    const skills = await loader.listSkills(false);
    assertEquals(skills.length, 1);
    assertEquals(skills[0].name, "valid");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// loadSkill
// ---------------------------------------------------------------------------

Deno.test("SkillsLoader - loadSkill returns content for existing skill", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createSkill(dir, "my-skill", 'name: my-skill\ndescription: "desc"', "# My Skill\n\nBody here.");
    const loader = new SkillsLoader(dir, dir);
    const content = await loader.loadSkill("my-skill");
    assertStringIncludes(content!, "# My Skill");
    assertStringIncludes(content!, "Body here.");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("SkillsLoader - loadSkill returns null for missing skill", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const loader = new SkillsLoader(dir, dir);
    const content = await loader.loadSkill("nonexistent");
    assertEquals(content, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// getSkillMetadata
// ---------------------------------------------------------------------------

Deno.test("SkillsLoader - getSkillMetadata parses YAML frontmatter", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createSkill(
      dir,
      "meta-skill",
      'name: meta-skill\ndescription: "A skill with metadata"\nalways: true',
      "# Content",
    );
    const loader = new SkillsLoader(dir, dir);
    const meta = await loader.getSkillMetadata("meta-skill");
    assertEquals(meta!["name"], "meta-skill");
    assertEquals(meta!["description"], "A skill with metadata");
    assertEquals(meta!["always"], "true");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("SkillsLoader - getSkillMetadata returns null for missing skill", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const loader = new SkillsLoader(dir, dir);
    const meta = await loader.getSkillMetadata("nonexistent");
    assertEquals(meta, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("SkillsLoader - getSkillMetadata handles content without frontmatter", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const skillDir = join(dir, "skills", "no-front");
    await Deno.mkdir(skillDir, { recursive: true });
    await Deno.writeTextFile(join(skillDir, "SKILL.md"), "# No frontmatter here");
    const loader = new SkillsLoader(dir, dir);
    const meta = await loader.getSkillMetadata("no-front");
    assertEquals(meta, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// getAlwaysSkills
// ---------------------------------------------------------------------------

Deno.test("SkillsLoader - getAlwaysSkills returns skills with always: true", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createSkill(dir, "always-skill", 'name: always-skill\ndescription: "Always"\nalways: true', "# Always");
    await createSkill(dir, "on-demand", 'name: on-demand\ndescription: "On demand"', "# On Demand");
    const loader = new SkillsLoader(dir, dir);
    const always = await loader.getAlwaysSkills();
    assertEquals(always, ["always-skill"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("SkillsLoader - getAlwaysSkills checks always in containerclaw metadata too", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createSkill(
      dir,
      "meta-always",
      'name: meta-always\ndescription: "Always via metadata"\nmetadata: {"containerclaw":{"always":true}}',
      "# Meta Always",
    );
    const loader = new SkillsLoader(dir, dir);
    const always = await loader.getAlwaysSkills();
    assertEquals(always, ["meta-always"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("SkillsLoader - getAlwaysSkills excludes skills with unmet requirements", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createSkill(
      dir,
      "always-but-missing",
      'name: always-but-missing\ndescription: "Always but missing"\nalways: true\nmetadata: {"containerclaw":{"requires":{"bins":["nonexistent_binary_xyz_12345"]}}}',
      "# Missing",
    );
    const loader = new SkillsLoader(dir, dir);
    const always = await loader.getAlwaysSkills();
    assertEquals(always, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// loadSkillsForContext
// ---------------------------------------------------------------------------

Deno.test("SkillsLoader - loadSkillsForContext strips frontmatter and formats", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createSkill(dir, "skill-a", 'name: skill-a\ndescription: "A"', "# Skill A\n\nContent A.");
    await createSkill(dir, "skill-b", 'name: skill-b\ndescription: "B"', "# Skill B\n\nContent B.");
    const loader = new SkillsLoader(dir, dir);
    const result = await loader.loadSkillsForContext(["skill-a", "skill-b"]);
    assertStringIncludes(result, "### Skill: skill-a");
    assertStringIncludes(result, "# Skill A");
    assertStringIncludes(result, "Content A.");
    assertStringIncludes(result, "---");
    assertStringIncludes(result, "### Skill: skill-b");
    assertStringIncludes(result, "# Skill B");
    // Should NOT contain frontmatter delimiters in skill content
    const parts = result.split("### Skill:");
    for (const part of parts.slice(1)) {
      assertEquals(part.includes("name:"), false);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("SkillsLoader - loadSkillsForContext returns empty string for no skills", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const loader = new SkillsLoader(dir, dir);
    const result = await loader.loadSkillsForContext([]);
    assertEquals(result, "");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("SkillsLoader - loadSkillsForContext skips missing skills gracefully", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createSkill(dir, "exists", 'name: exists\ndescription: "Exists"', "# Exists");
    const loader = new SkillsLoader(dir, dir);
    const result = await loader.loadSkillsForContext(["exists", "nonexistent"]);
    assertStringIncludes(result, "### Skill: exists");
    assertEquals(result.includes("nonexistent"), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// buildSkillsSummary
// ---------------------------------------------------------------------------

Deno.test("SkillsLoader - buildSkillsSummary returns XML with available skills", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createSkill(dir, "avail", 'name: avail\ndescription: "An available skill"', "# Available");
    const loader = new SkillsLoader(dir, dir);
    const xml = await loader.buildSkillsSummary();
    assertStringIncludes(xml, "<skills>");
    assertStringIncludes(xml, "</skills>");
    assertStringIncludes(xml, '<skill available="true">');
    assertStringIncludes(xml, "<name>avail</name>");
    assertStringIncludes(xml, "<description>An available skill</description>");
    assertStringIncludes(xml, "<location>");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("SkillsLoader - buildSkillsSummary marks unavailable skills with requires", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createSkill(
      dir,
      "unavail",
      'name: unavail\ndescription: "Needs stuff"\nmetadata: {"containerclaw":{"requires":{"bins":["nonexistent_binary_xyz_12345"]}}}',
      "# Unavail",
    );
    const loader = new SkillsLoader(dir, dir);
    const xml = await loader.buildSkillsSummary();
    assertStringIncludes(xml, '<skill available="false">');
    assertStringIncludes(xml, "<requires>");
    assertStringIncludes(xml, "CLI: nonexistent_binary_xyz_12345");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("SkillsLoader - buildSkillsSummary returns empty string when no skills", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const loader = new SkillsLoader(dir, dir);
    const xml = await loader.buildSkillsSummary();
    assertEquals(xml, "");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("SkillsLoader - buildSkillsSummary escapes XML special characters", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createSkill(
      dir,
      "xml-test",
      'name: xml-test\ndescription: "Use <tags> & stuff"',
      "# XML Test",
    );
    const loader = new SkillsLoader(dir, dir);
    const xml = await loader.buildSkillsSummary();
    assertStringIncludes(xml, "&lt;tags&gt;");
    assertStringIncludes(xml, "&amp;");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// seedDefaultSkills
// ---------------------------------------------------------------------------

Deno.test("SkillsLoader - seedDefaultSkills copies defaults to workspace", async () => {
  const workspace = await Deno.makeTempDir();
  const defaults = await Deno.makeTempDir();
  try {
    // Create a default skill
    const defSkillDir = join(defaults, "default-skill");
    await Deno.mkdir(defSkillDir, { recursive: true });
    await Deno.writeTextFile(join(defSkillDir, "SKILL.md"), "---\nname: default-skill\n---\n\n# Default");

    const loader = new SkillsLoader(workspace, defaults);
    await loader.seedDefaultSkills();

    // Verify it was copied to workspace
    const content = await Deno.readTextFile(join(workspace, "skills", "default-skill", "SKILL.md"));
    assertStringIncludes(content, "# Default");
  } finally {
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(defaults, { recursive: true });
  }
});

Deno.test("SkillsLoader - seedDefaultSkills does not overwrite existing workspace skills", async () => {
  const workspace = await Deno.makeTempDir();
  const defaults = await Deno.makeTempDir();
  try {
    // Create a default skill
    const defSkillDir = join(defaults, "my-skill");
    await Deno.mkdir(defSkillDir, { recursive: true });
    await Deno.writeTextFile(join(defSkillDir, "SKILL.md"), "---\nname: my-skill\n---\n\n# Default Version");

    // Create same skill in workspace (user's version)
    await createSkill(workspace, "my-skill", "name: my-skill", "# User Version");

    const loader = new SkillsLoader(workspace, defaults);
    await loader.seedDefaultSkills();

    // Verify workspace version is preserved
    const content = await Deno.readTextFile(join(workspace, "skills", "my-skill", "SKILL.md"));
    assertStringIncludes(content, "# User Version");
    assertEquals(content.includes("# Default Version"), false);
  } finally {
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(defaults, { recursive: true });
  }
});

Deno.test("SkillsLoader - seedDefaultSkills is idempotent", async () => {
  const workspace = await Deno.makeTempDir();
  const defaults = await Deno.makeTempDir();
  try {
    const defSkillDir = join(defaults, "idempotent-skill");
    await Deno.mkdir(defSkillDir, { recursive: true });
    await Deno.writeTextFile(join(defSkillDir, "SKILL.md"), "---\nname: idempotent-skill\n---\n\n# Content");

    const loader = new SkillsLoader(workspace, defaults);
    await loader.seedDefaultSkills();
    await loader.seedDefaultSkills(); // Second call should not fail

    const content = await Deno.readTextFile(join(workspace, "skills", "idempotent-skill", "SKILL.md"));
    assertStringIncludes(content, "# Content");
  } finally {
    await Deno.remove(workspace, { recursive: true });
    await Deno.remove(defaults, { recursive: true });
  }
});

Deno.test("SkillsLoader - seedDefaultSkills handles missing defaults dir gracefully", async () => {
  const workspace = await Deno.makeTempDir();
  try {
    const loader = new SkillsLoader(workspace, "/nonexistent/path/to/defaults");
    // Should not throw
    await loader.seedDefaultSkills();
  } finally {
    await Deno.remove(workspace, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// env var requirement checking
// ---------------------------------------------------------------------------

Deno.test("SkillsLoader - filters skills with missing env vars", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await createSkill(
      dir,
      "needs-env",
      'name: needs-env\ndescription: "Needs env"\nmetadata: {"containerclaw":{"requires":{"env":["NONEXISTENT_ENV_VAR_XYZ_12345"]}}}',
      "# Needs env",
    );
    const loader = new SkillsLoader(dir, dir);
    const filtered = await loader.listSkills();
    assertEquals(filtered.length, 0);

    const all = await loader.listSkills(false);
    assertEquals(all.length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
