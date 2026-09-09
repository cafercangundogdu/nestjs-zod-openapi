import 'reflect-metadata';
import type { SwaggerDocumentOptions } from '@nestjs/swagger';
import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  createStandardSchemaConverter,
  createZodDto,
  isZodDto,
  type StandardSchemaConverter,
  type ZodDtoStatic,
  ZodValidationPipe,
} from '../src';

/**
 * Type-level tests. `expectTypeOf` compiles away to nothing at runtime — the
 * assertions are enforced by `pnpm run typecheck`, which type-checks `test/**`.
 * (Vitest's `typecheck` mode is deliberately not enabled: it drives `tsc` itself
 * and TypeScript 7's native compiler is not wired up for it.)
 */

const UserSchema = z.object({
  name: z.string(),
  age: z.number(),
  bio: z.string().optional(),
  role: z.enum(['admin', 'user']).default('user'),
});

class UserDto extends createZodDto(UserSchema) {}

const CatSchema = z.object({ type: z.literal('cat'), meow: z.string() });
const DogSchema = z.object({ type: z.literal('dog'), bark: z.string() });
const AnimalSchema = z.discriminatedUnion('type', [CatSchema, DogSchema]);

class AnimalDto extends createZodDto(AnimalSchema) {}

describe('createZodDto — types', () => {
  it('exposes the object schema properties on the instance type', () => {
    expectTypeOf<UserDto>().toExtend<{ name: string; age: number }>();
    expectTypeOf<UserDto['name']>().toEqualTypeOf<string>();
    expectTypeOf<UserDto['age']>().toEqualTypeOf<number>();
    expectTypeOf<UserDto['bio']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<UserDto['role']>().toEqualTypeOf<'admin' | 'user'>();
  });

  it('types static create() as the schema output', () => {
    expectTypeOf(UserDto.create).returns.toEqualTypeOf<z.output<typeof UserSchema>>();
    expectTypeOf(UserDto.create).parameters.toEqualTypeOf<[unknown]>();
  });

  it('keeps the original schema on the static side', () => {
    expectTypeOf(UserDto.schema).toEqualTypeOf<typeof UserSchema>();
    expectTypeOf(UserDto.zodSchema).toEqualTypeOf<typeof UserSchema>();
    expectTypeOf(UserDto.isZodDto).toEqualTypeOf<true>();
  });

  it('supports extending a discriminated-union DTO and keeps the union schema', () => {
    expectTypeOf(AnimalDto.schema).toEqualTypeOf<typeof AnimalSchema>();
    expectTypeOf(AnimalDto.create).returns.toEqualTypeOf<z.output<typeof AnimalSchema>>();
    // The mapped instance type collapses to the keys shared by every member.
    expectTypeOf<AnimalDto['type']>().toEqualTypeOf<'cat' | 'dog'>();
  });
});

describe('isZodDto — types', () => {
  it('narrows an unknown value to ZodDtoStatic', () => {
    const metatype: unknown = UserDto;

    if (isZodDto(metatype)) {
      expectTypeOf(metatype).toEqualTypeOf<ZodDtoStatic>();
      expectTypeOf(metatype.schema).toEqualTypeOf<z.ZodType>();
    } else {
      expectTypeOf(metatype).toEqualTypeOf<unknown>();
    }
  });
});

describe('ZodValidationPipe — types', () => {
  it('accepts a Zod schema, a ZodDto class, or no argument at all', () => {
    expectTypeOf(ZodValidationPipe).toBeConstructibleWith();
    expectTypeOf(ZodValidationPipe).toBeConstructibleWith(UserSchema);
    expectTypeOf(ZodValidationPipe).toBeConstructibleWith(AnimalSchema);
    expectTypeOf(ZodValidationPipe).toBeConstructibleWith(UserDto);
    expectTypeOf(ZodValidationPipe).toBeConstructibleWith(undefined);
  });
});

/**
 * `SwaggerDocumentOptions` only carries `standardSchemaConverter` on
 * `@nestjs/swagger` 12; on 11 the optional-property `infer` below resolves to
 * `unknown`. Falling back to this library's own `StandardSchemaConverter` in that
 * case keeps the assertion a real cross-package check on 12 and a tautology on 11,
 * so the CI leg that installs `@nestjs/swagger@11` still type-checks.
 */
type SwaggerStandardSchemaConverter = SwaggerDocumentOptions extends {
  standardSchemaConverter?: infer C;
}
  ? unknown extends C
    ? StandardSchemaConverter
    : NonNullable<C>
  : StandardSchemaConverter;

describe('createStandardSchemaConverter — types', () => {
  it("is assignable to @nestjs/swagger's standardSchemaConverter option", () => {
    expectTypeOf(createStandardSchemaConverter()).toExtend<SwaggerStandardSchemaConverter>();
  });
});
