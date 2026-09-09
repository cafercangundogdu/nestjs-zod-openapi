# @cafercangundogdu/nestjs-zod-openapi

[![npm version](https://img.shields.io/npm/v/@cafercangundogdu/nestjs-zod-openapi.svg)](https://www.npmjs.com/package/@cafercangundogdu/nestjs-zod-openapi)
[![npm downloads](https://img.shields.io/npm/dm/@cafercangundogdu/nestjs-zod-openapi.svg)](https://www.npmjs.com/package/@cafercangundogdu/nestjs-zod-openapi)
[![CI](https://github.com/cafercangundogdu/nestjs-zod-openapi/actions/workflows/ci.yml/badge.svg)](https://github.com/cafercangundogdu/nestjs-zod-openapi/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![NestJS](https://img.shields.io/badge/NestJS-11+-ea2845.svg)](https://nestjs.com/)
[![Zod](https://img.shields.io/badge/Zod-4+-3068b7.svg)](https://zod.dev/)

> Type-safe NestJS DTOs from Zod 4 schemas with full OpenAPI support — `discriminatedUnion` → `oneOf`, nested `$ref`, `enum`, and more.

## Features

- `z.discriminatedUnion()` → OpenAPI `oneOf` with `discriminator`
- `z.union()` → OpenAPI `anyOf`
- `z.nativeEnum()` → OpenAPI `enum`
- `.openapi('Name')` → named `$ref` in `components/schemas`
- `ZodValidationPipe` — request validation with structured error responses
- `createZodDto()` — type-safe DTO classes from any Zod schema

## Install

```bash
pnpm add @cafercangundogdu/nestjs-zod-openapi
```

Peer dependencies: `@nestjs/common ^11 || ^12`, `@nestjs/swagger ^11 || ^12`, `zod ^4`

## Quick start

### 1. Initialize Zod OpenAPI

Call `initZodOpenApi(z)` **at the very top** of your `main.ts`, before any module imports that use `.openapi()`:

```typescript
// src/zod-init.ts (create this file)
import { z } from 'zod';
import { initZodOpenApi } from '@cafercangundogdu/nestjs-zod-openapi';

initZodOpenApi(z);
```

```typescript
// src/main.ts
import './zod-init'; // must be first import

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { patchNestSwagger } from '@cafercangundogdu/nestjs-zod-openapi';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  patchNestSwagger({ schemasSort: 'alpha' });

  const config = new DocumentBuilder()
    .setTitle('My API')
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(3000);
}
bootstrap();
```

> **Why a separate file?** `initZodOpenApi(z)` must run before any DTO file that calls `.openapi()` is loaded. Putting it in a separate file imported first guarantees execution order.

### 2. Create DTOs

```typescript
import { z } from 'zod';
import { createZodDto } from '@cafercangundogdu/nestjs-zod-openapi';

const UserSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
  })
  .openapi('User');

export class UserDto extends createZodDto(UserSchema) {}
```

### 3. Validate requests

```typescript
import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from '@cafercangundogdu/nestjs-zod-openapi';

@Module({
  providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
})
export class AppModule {}
```

## Discriminated union → oneOf

```typescript
const TextPart = z
  .object({ type: z.literal('text'), content: z.string() })
  .openapi('TextPart');

const ImagePart = z
  .object({ type: z.literal('image'), url: z.string().url() })
  .openapi('ImagePart');

const MessagePart = z
  .discriminatedUnion('type', [TextPart, ImagePart])
  .openapi('MessagePart');

// Union DTOs use const assignment (not extends)
export const MessagePartDto = createZodDto(MessagePart);
export type MessagePartInput = z.output<typeof MessagePart>;
```

OpenAPI output:

```yaml
MessagePart:
  oneOf:
    - $ref: '#/components/schemas/TextPart'
    - $ref: '#/components/schemas/ImagePart'
  discriminator:
    propertyName: type
    mapping:
      text: '#/components/schemas/TextPart'
      image: '#/components/schemas/ImagePart'
```

## Nested $ref

```typescript
const Address = z
  .object({ street: z.string(), city: z.string() })
  .openapi('Address');

const User = z
  .object({ name: z.string(), address: Address })
  .openapi('User');
```

```yaml
User:
  properties:
    name: { type: string }
    address: { $ref: '#/components/schemas/Address' }
```

## Union DTOs in controllers

Object DTOs work directly as types:

```typescript
@Body() body: CreateUserDto  // ✅ works
```

Union/discriminatedUnion DTOs need a companion type:

```typescript
// dto.ts
export const MessagePartDto = createZodDto(MessagePartSchema);
export type MessagePartInput = z.output<typeof MessagePartSchema>;

// controller.ts
@Post()
@ApiCreatedResponse({ type: MessagePartDto })  // Swagger
async create(@Body() body: MessagePartInput) {  // TypeScript type
  return body;
}
```

## NestJS 12: Standard Schema

NestJS 12 accepts a Standard Schema directly on the parameter decorators — no DTO class needed. Zod 4 schemas are Standard Schemas, so they can be passed as-is:

```typescript
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { z } from 'zod';

@Controller('users')
export class UsersController {
  @Post()
  @ApiOkResponse({ standardSchema: UserSchema })
  create(@Body({ schema: CreateUserSchema }) body: z.infer<typeof CreateUserSchema>) {
    return body;
  }

  @Get(':id')
  @ApiOkResponse({ standardSchema: UserSchema })
  findOne(
    @Param('id', { schema: z.string().uuid() }) id: string,
    @Query({ schema: ListUsersSchema }) query: z.infer<typeof ListUsersSchema>,
  ) {
    return { id, query };
  }
}
```

`patchNestSwagger()` handles the Swagger side automatically — it injects `createStandardSchemaConverter()` into `SwaggerModule.createDocument()`. `ZodValidationPipe` registered globally validates these parameters too, throwing the same `BadRequestException` as it does for `createZodDto()` classes.

If you don't use the patch, pass the converter yourself:

```typescript
import { createStandardSchemaConverter } from '@cafercangundogdu/nestjs-zod-openapi';

const document = SwaggerModule.createDocument(app, config, {
  standardSchemaConverter: createStandardSchemaConverter(),
});
```

To keep `@nestjs/swagger`'s built-in conversion instead, opt out:

```typescript
patchNestSwagger({ standardSchemaConverter: false });
```

`patchNestSwagger({ standardSchemaConverter: myConverter })` also accepts a custom converter, and a `standardSchemaConverter` passed to `createDocument()` by your app always wins.

What the converter gives you over the built-in conversion:

- `.openapi('Name')` schemas become `components/schemas/Name` referenced by `$ref` (nested named schemas become components too); unnamed schemas are inlined
- `z.discriminatedUnion()` → `oneOf` with `discriminator`
- `z.coerce.date()` → `string` / `date-time` (the built-in conversion throws *Date cannot be represented in JSON Schema*)
- spurious `nullable` on `z.coerce.*` stripped, `format` checks (uuid, email, …) gain their regex `pattern`
- non-Zod Standard Schemas (Valibot, ArkType, …) fall back to `@nestjs/swagger`'s built-in conversion

> Transforms and pipes are described from their **input** side for both request and response schemas — same limitation as `createZodDto()`.

On `@nestjs/swagger` 11 all of this is inert; nothing changes for NestJS 11 users.

## API

| Export | Description |
|--------|-------------|
| `initZodOpenApi(z)` | Extends Zod with `.openapi()`. Call once before DTOs load. |
| `createZodDto(schema)` | Creates a DTO class from any Zod schema. |
| `ZodValidationPipe` | NestJS pipe — validates against DTO's Zod schema. |
| `patchNestSwagger(opts?)` | Patches Swagger to generate schemas from Zod. |
| `createStandardSchemaConverter()` | `standardSchemaConverter` for `createDocument()` — renders Zod Standard Schemas (NestJS 12). |
| `isZodDto(value)` | Type guard for ZodDto classes. |

## Compatibility

| Dependency | Version |
|------------|---------|
| `@nestjs/common` | ^11 \|\| ^12 |
| `@nestjs/swagger` | ^11 \|\| ^12 |
| `zod` | ^4 |
| `node` | >= 22.12 |

NestJS 12 ships ESM-only packages. Both the CommonJS and ESM builds of this library work with it unchanged — Node loads the `@nestjs/*` internals through `require(esm)`, so no changes to your app are needed.

## How it works

`patchNestSwagger()` monkey-patches `@nestjs/swagger` internals:

- `SchemaObjectFactory.prototype.exploreModelSchema` — routes Zod DTOs through [@asteasolutions/zod-to-openapi](https://github.com/asteasolutions/zod-to-openapi)
- `SwaggerScanner.prototype.scanApplication` — merges generated schemas into the document and injects the Standard Schema converter
- `SchemaObjectFactory.prototype.getSchemaOverride` (`@nestjs/swagger` 12 only) — expands an unnamed `@Query({ schema })` / `@Param({ schema })` whose schema is named with `.openapi('Name')` into individual parameters

`initZodOpenApi(z)` passes **your** Zod instance to `extendZodWithOpenApi()`, avoiding duplicate-package issues in pnpm/monorepo setups.

> Since this relies on `@nestjs/swagger` internals, a major Swagger update may require a corresponding update here. Tested against `@nestjs/swagger ^11` and `^12`.

## Development

Requires Node 22+ and pnpm 11 — the `packageManager` field pins the exact version, so `corepack enable` is enough.

```bash
pnpm install
pnpm test              # Vitest
pnpm run test:watch
pnpm run test:cov
pnpm run lint          # Biome
pnpm run typecheck
pnpm run build         # CJS + ESM
pnpm run check:package # publint + are-the-types-wrong
```

CI runs the suite on Node 22/24 × NestJS 11/12 — tests that need NestJS 12 features are skipped on the 11 leg.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint via a husky hook.

Changelog: [CHANGELOG.md](CHANGELOG.md).

### Releasing

Releases are driven by [release-please](https://github.com/googleapis/release-please). Every push to `main` refreshes a `chore(main): release x.y.z` pull request built from the Conventional Commits since the last tag — `feat` bumps the minor, `fix` the patch, and while the package is below 1.0.0 a `!` / `BREAKING CHANGE` bumps the minor too.

Merging that PR bumps `package.json` and `.release-please-manifest.json`, rewrites `CHANGELOG.md`, and creates the `vX.Y.Z` tag and GitHub release. The publish workflow then runs on that push to `main` and publishes to npm with provenance — it skips versions already on npm, so ordinary merges are no-ops.

One-time bootstrap for 0.2.0 — release-please needs the manifest version to exist as a release before it takes over, so after merging this work create it by hand:

```bash
gh release create v0.2.0 --title v0.2.0 --notes-file <(sed -n '/^## \[0.2.0\]/,/^## \[/p' CHANGELOG.md)
```

The npm publish of 0.2.0 happens on its own from the push to `main`. With the default `GITHUB_TOKEN` the release PR runs no CI checks — add a `RELEASE_PLEASE_TOKEN` secret (a PAT with contents + pull-requests write) to fix that.

## Inspired by

- [@asteasolutions/zod-to-openapi](https://github.com/asteasolutions/zod-to-openapi) — Zod → OpenAPI schema generation
- [@wahyubucil/nestjs-zod-openapi](https://github.com/wahyubucil/nestjs-zod-openapi) — Zod 3 + NestJS 10 integration
- [@anatine/zod-nestjs](https://github.com/anatine/zod-plugins/tree/main/packages/zod-nestjs) — Zod DTO integration
- [nestjs-zod](https://github.com/BenLorantfy-Leapsome/nestjs-zod) — Zod integration for NestJS

## License

[MIT](LICENSE)
