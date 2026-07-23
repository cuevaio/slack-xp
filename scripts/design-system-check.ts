export {};

const sourceFiles = await Array.fromAsync(
  new Bun.Glob("src/**/*.{css,ts,tsx}").scan("."),
);

const violations: string[] = [];
const colorLiteral =
  /(?<!&)(?:#[\da-f]{3}(?:[\da-f]{3})?(?:[\da-f]{2})?(?![\da-f])|(?:rgb|hsl|oklch)a?\([^)]*\))/gi;
const inlineStyle = /\bstyle\s*=\s*\{/g;
const arbitraryColor =
  /(?:bg|text|border|outline|ring|shadow)-\[(?:#|(?:rgb|hsl|oklch)a?\()/gi;
const rawSpacing =
  /\b(?:padding|margin|gap)(?:-[a-z]+)?\s*:\s*[^;]*(?:-?\d*\.?\d+(?:px|rem))/gi;

for (const file of sourceFiles) {
  const source = await Bun.file(file).text();
  let checkedSource = source;

  if (file === "src/app/globals.css") {
    const rootEnd = source.indexOf("\n}\n\n@theme inline");
    if (rootEnd === -1) {
      violations.push(`${file}: could not locate the design-token boundary`);
      continue;
    }
    checkedSource = source.slice(rootEnd + 3);
  }

  for (const match of checkedSource.matchAll(colorLiteral)) {
    violations.push(`${file}: raw color ${match[0]}`);
  }
  for (const _match of source.matchAll(inlineStyle)) {
    violations.push(`${file}: React style attribute`);
  }
  for (const match of source.matchAll(arbitraryColor)) {
    violations.push(`${file}: arbitrary color utility ${match[0]}`);
  }
  if (file.endsWith(".css")) {
    for (const match of checkedSource.matchAll(rawSpacing)) {
      violations.push(`${file}: raw spacing ${match[0]}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Design-system violations:\n");
  console.error(violations.map((violation) => `- ${violation}`).join("\n"));
  process.exit(1);
}

console.log("Design-system color, spacing, and inline-style checks passed.");
