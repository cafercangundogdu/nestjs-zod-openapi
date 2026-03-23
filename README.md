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

Peer dependencies: `@nestjs/common ^11`, `@nestjs/swagger ^11`, `zod ^4`

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

## API

| Export | Description |
|--------|-------------|
| `initZodOpenApi(z)` | Extends Zod with `.openapi()`. Call once before DTOs load. |
| `createZodDto(schema)` | Creates a DTO class from any Zod schema. |
| `ZodValidationPipe` | NestJS pipe — validates against DTO's Zod schema. |
| `patchNestSwagger(opts?)` | Patches Swagger to generate schemas from Zod. |
| `isZodDto(value)` | Type guard for ZodDto classes. |

## Compatibility

| Dependency | Version |
|------------|---------|
| `@nestjs/common` | ^11 |
| `@nestjs/swagger` | ^11 |
| `zod` | ^4 |
| `node` | >= 22 |

## How it works

`patchNestSwagger()` monkey-patches two `@nestjs/swagger` internals:

- `SchemaObjectFactory.prototype.exploreModelSchema` — routes Zod DTOs through [@asteasolutions/zod-to-openapi](https://github.com/asteasolutions/zod-to-openapi)
- `SwaggerScanner.prototype.scanApplication` — merges generated schemas into the document

`initZodOpenApi(z)` passes **your** Zod instance to `extendZodWithOpenApi()`, avoiding duplicate-package issues in pnpm/monorepo setups.

> Since this relies on `@nestjs/swagger` internals, a major Swagger update may require a corresponding update here. Tested against `@nestjs/swagger ^11`.

## Inspired by

- [@asteasolutions/zod-to-openapi](https://github.com/asteasolutions/zod-to-openapi) — Zod → OpenAPI schema generation
- [@wahyubucil/nestjs-zod-openapi](https://github.com/wahyubucil/nestjs-zod-openapi) — Zod 3 + NestJS 10 integration
- [@anatine/zod-nestjs](https://github.com/anatine/zod-plugins/tree/main/packages/zod-nestjs) — Zod DTO integration
- [nestjs-zod](https://github.com/BenLorantfy-Leapsome/nestjs-zod) — Zod integration for NestJS

## License

[MIT](LICENSE)
