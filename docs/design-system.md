# Portal XP Design System

Portal XP uses source-owned shadcn components with a Windows XP and early-2000s
desktop treatment. The visual language is nostalgic; the interaction and
accessibility behavior should remain modern.

## Foundations

Semantic tokens live in `src/app/globals.css`. Feature components should use
semantic Tailwind utilities such as `bg-primary`, `text-muted-foreground`, and
`border-border` instead of introducing raw colors.

The legacy names (`--navy`, `--paper`, and similar) are aliases during the CSS
migration. New component code should use the semantic names.

## Spacing

Use Tailwind's 4px spacing scale and prefer `gap-*` for sibling relationships.

| Relationship | Token | Size |
| --- | --- | --- |
| Icon to label | `gap-1` or `gap-2` | 4-8px |
| Related controls | `gap-2` | 8px |
| Fields in a form | `gap-3` or `gap-4` | 12-16px |
| Sections in a panel | `gap-6` | 24px |
| Page regions | `gap-8` or responsive `clamp()` | 32px+ |

Rules:

- Use container `gap` instead of `space-x-*`, `space-y-*`, or margins between siblings.
- Use padding for a component's internal breathing room and gap for relationships.
- Use `size-*` when width and height are equal.
- Keep standard controls at `h-9`; use `h-8` for dense secondary controls and `h-11` for primary touch targets.
- Keep mobile interactive targets at least 44px when controls are isolated or frequently tapped.

## Components

Import primitives from `@/components/ui/*`.

- `Button`: classic beveled control by default. Use `primary` for the single main action and `destructive` for irreversible actions.
- `Input` and `Textarea`: inset white work surfaces with a shared focus and invalid state.
- `Label`: consistent field typography and disabled behavior. Always connect it with `htmlFor` and an input `id`.
- `Badge`: compact status metadata. Use `warning` for attention, not for errors.
- `Alert`: system feedback. Use `destructive` only when the user needs to correct or retry something.

Pass `className` for layout concerns such as width, alignment, or placement. Add
visual variants to the primitive instead of overriding its colors in feature
code.

## Motion

Interaction motion uses `--ease-out` and stays below 200ms. Pressable controls
scale to 97% for immediate feedback. Do not use `transition-all`, animate layout
properties, or animate frequently repeated keyboard actions. Reduced-motion
users keep state and color feedback but do not receive movement.

## Adding Components

Install shadcn components with Bun and then apply the Portal XP treatment in the
generated source:

```sh
bunx --bun shadcn@latest docs <component>
bunx --bun shadcn@latest add <component> --yes
```

Run a focused check after editing:

```sh
bunx biome check src/components/ui/<component>.tsx
```
