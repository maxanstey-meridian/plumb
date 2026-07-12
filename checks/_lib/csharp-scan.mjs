import fs from "node:fs";
import path from "node:path";
import { walkFiles } from "./fs-scan.mjs";

export function* csharpFiles(root) {
  yield* walkFiles(root, root, { filter: (name) => name.endsWith(".cs") });
}

export function maskCSharp(source, { preserveStringDelimiters = false } = {}) {
  let output = "";
  let state = "code";
  let rawDelimiter = "";
  let verbatim = false;

  const blank = (value) => value === "\n" ? "\n" : " ";
  for (let index = 0; index < source.length; index++) {
    const current = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      output += blank(current);
      if (current === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (current === "*" && next === "/") {
        output += "  ";
        index++;
        state = "code";
      } else output += blank(current);
      continue;
    }
    if (state === "raw-string") {
      if (source.startsWith(rawDelimiter, index)) {
        output += " ".repeat(rawDelimiter.length);
        index += rawDelimiter.length - 1;
        state = "code";
      } else output += blank(current);
      continue;
    }
    if (state === "string") {
      if (verbatim && current === '"' && next === '"') {
        output += "  ";
        index++;
      } else if (!verbatim && current === "\\") {
        output += " ";
        if (next !== undefined) {
          output += blank(next);
          index++;
        }
      } else if (current === '"') {
        output += preserveStringDelimiters ? '"' : " ";
        state = "code";
      } else output += blank(current);
      continue;
    }
    if (state === "character") {
      if (current === "\\") {
        output += " ";
        if (next !== undefined) {
          output += blank(next);
          index++;
        }
      } else {
        output += blank(current);
        if (current === "'") state = "code";
      }
      continue;
    }

    if (current === "/" && next === "/") {
      output += "  ";
      index++;
      state = "line-comment";
    } else if (current === "/" && next === "*") {
      output += "  ";
      index++;
      state = "block-comment";
    } else if (source.startsWith('"""', index)) {
      rawDelimiter = source.slice(index).match(/^"{3,}/)[0];
      output += " ".repeat(rawDelimiter.length);
      index += rawDelimiter.length - 1;
      state = "raw-string";
    } else if (current === '"') {
      verbatim = index > 0 && source[index - 1] === "@";
      output += preserveStringDelimiters ? '"' : " ";
      state = "string";
    } else if (current === "'") {
      output += " ";
      state = "character";
    } else output += current;
  }
  return output;
}

export function nearestProject(root, file) {
  let directory = path.dirname(file);
  while (directory.startsWith(root)) {
    const project = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".csproj"))
      .map((entry) => path.join(directory, entry.name))
      .sort()[0];
    if (project) return project;
    if (directory === root) break;
    directory = path.dirname(directory);
  }
  return root;
}

export function isTestSource(root, file, project = nearestProject(root, file)) {
  if (project !== root) {
    const name = path.basename(project);
    const source = fs.readFileSync(project, "utf8");
    if (/Tests?\.csproj$/i.test(name) ||
        /<IsTestProject>\s*true\s*<\/IsTestProject>/i.test(source) ||
        /Microsoft\.NET\.Test\.Sdk/i.test(source)) return true;
  }
  const relative = path.relative(root, file).split(path.sep);
  return relative.some((segment) => /^(?:tests?|.+\.tests?)$/i.test(segment)) || /Tests?\.cs$/i.test(path.basename(file));
}

export function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}
