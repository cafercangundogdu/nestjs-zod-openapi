import 'reflect-metadata';
import { z } from 'zod';
import { createZodDto, isZodDto } from '../src';

describe('createZodDto', () => {
  const UserSchema = z
    .object({
      name: z.string(),
      age: z.number(),
    })
    .openapi('User');

  class UserDto extends createZodDto(UserSchema) {}

  it('should create a DTO from z.object() with correct instance type', () => {
    const instance = new UserDto();
    expect(instance).toBeInstanceOf(UserDto);
  });

  it('should create a DTO from z.union() without error', () => {
    const UnionSchema = z.union([z.string(), z.number()]).openapi('StringOrNumber');
    expect(() => createZodDto(UnionSchema)).not.toThrow();
  });

  it('should create a DTO from z.discriminatedUnion() without error', () => {
    const CatSchema = z.object({ type: z.literal('cat'), meow: z.string() }).openapi('Cat');
    const DogSchema = z.object({ type: z.literal('dog'), bark: z.string() }).openapi('Dog');
    const AnimalSchema = z.discriminatedUnion('type', [CatSchema, DogSchema]).openapi('Animal');

    expect(() => createZodDto(AnimalSchema)).not.toThrow();
  });

  it('should expose static "schema" property', () => {
    expect(UserDto.schema).toBe(UserSchema);
  });

  it('should expose static "zodSchema" property (alias)', () => {
    expect(UserDto.zodSchema).toBe(UserSchema);
  });

  it('should have static "isZodDto" set to true', () => {
    expect(UserDto.isZodDto).toBe(true);
  });

  it('should parse valid input via static create()', () => {
    const result = UserDto.create({ name: 'Alice', age: 30 });
    expect(result).toEqual({ name: 'Alice', age: 30 });
  });

  it('should throw on invalid input via static create()', () => {
    expect(() => UserDto.create({ name: 123 })).toThrow();
  });

  it('should expose _OPENAPI_METADATA_FACTORY that returns object (not undefined/null)', () => {
    const result = UserDto._OPENAPI_METADATA_FACTORY();
    // Must NOT be undefined — @nestjs/swagger does Object.keys(metadata) on it
    expect(result).not.toBeUndefined();
    expect(result).not.toBeNull();
    expect(typeof result).toBe('object');
  });

  it('should use .openapi() refId as class name when provided', () => {
    const NamedSchema = z.object({ x: z.string() }).openapi('MyModel');
    const DtoClass = createZodDto(NamedSchema);
    expect(DtoClass.name).toBe('MyModel');
  });

  it('should keep default class name when .openapi() is not used', () => {
    const PlainSchema = z.object({ x: z.string() });
    const DtoClass = createZodDto(PlainSchema);
    expect(DtoClass.name).toBe('AugmentedZodDto');
  });

  it('should produce an extended class that keeps its own name', () => {
    expect(UserDto.name).toBe('UserDto');
  });

  // --- Edge cases: z.optional() / z.nullable() / z.nullish() ---

  it('should handle z.optional() fields', () => {
    const Schema = z.object({ name: z.string(), bio: z.string().optional() });
    class Dto extends createZodDto(Schema) {}

    const withBio = Dto.create({ name: 'Alice', bio: 'hello' });
    expect(withBio).toEqual({ name: 'Alice', bio: 'hello' });

    const withoutBio = Dto.create({ name: 'Alice' });
    expect(withoutBio).toEqual({ name: 'Alice' });
  });

  it('should handle z.nullable() fields', () => {
    const Schema = z.object({ name: z.string(), bio: z.string().nullable() });
    class Dto extends createZodDto(Schema) {}

    const withNull = Dto.create({ name: 'Alice', bio: null });
    expect(withNull).toEqual({ name: 'Alice', bio: null });

    const withValue = Dto.create({ name: 'Alice', bio: 'hello' });
    expect(withValue).toEqual({ name: 'Alice', bio: 'hello' });
  });

  it('should handle z.nullish() fields', () => {
    const Schema = z.object({ name: z.string(), bio: z.string().nullish() });
    class Dto extends createZodDto(Schema) {}

    expect(Dto.create({ name: 'Alice', bio: null })).toEqual({ name: 'Alice', bio: null });
    expect(Dto.create({ name: 'Alice' })).toEqual({ name: 'Alice' });
    expect(Dto.create({ name: 'Alice', bio: 'hi' })).toEqual({ name: 'Alice', bio: 'hi' });
  });

  // --- Edge cases: z.default() ---

  it('should handle z.default() values', () => {
    const Schema = z.object({ role: z.string().default('user'), name: z.string() });
    class Dto extends createZodDto(Schema) {}

    const withDefault = Dto.create({ name: 'Alice' });
    expect(withDefault).toEqual({ role: 'user', name: 'Alice' });

    const withOverride = Dto.create({ name: 'Alice', role: 'admin' });
    expect(withOverride).toEqual({ role: 'admin', name: 'Alice' });
  });

  // --- Edge cases: z.array() of complex types ---

  it('should handle z.array() of objects', () => {
    const ItemSchema = z.object({ id: z.number(), label: z.string() });
    const Schema = z.object({ items: z.array(ItemSchema) });
    class Dto extends createZodDto(Schema) {}

    const result = Dto.create({
      items: [
        { id: 1, label: 'a' },
        { id: 2, label: 'b' },
      ],
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({ id: 1, label: 'a' });
  });

  // --- Edge cases: z.record() ---

  it('should handle z.record() with typed values', () => {
    const Schema = z.object({ tags: z.record(z.string(), z.number()) });
    class Dto extends createZodDto(Schema) {}

    const result = Dto.create({ tags: { views: 100, likes: 50 } });
    expect(result.tags).toEqual({ views: 100, likes: 50 });
  });

  // --- Edge cases: z.coerce.date() ---

  it('should handle z.coerce.date() in DTO', () => {
    const Schema = z.object({ createdAt: z.coerce.date() });
    class Dto extends createZodDto(Schema) {}

    const result = Dto.create({ createdAt: '2026-01-01' });
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  // --- Edge cases: z.nativeEnum() with string and numeric enums ---

  it('should handle z.nativeEnum() with string enum', () => {
    enum Color {
      Red = 'red',
      Blue = 'blue',
    }
    const Schema = z.object({ color: z.nativeEnum(Color) });
    class Dto extends createZodDto(Schema) {}

    expect(Dto.create({ color: 'red' })).toEqual({ color: 'red' });
    expect(() => Dto.create({ color: 'green' })).toThrow();
  });

  it('should handle z.nativeEnum() with numeric enum', () => {
    enum Priority {
      Low = 0,
      Medium = 1,
      High = 2,
    }
    const Schema = z.object({ priority: z.nativeEnum(Priority) });
    class Dto extends createZodDto(Schema) {}

    expect(Dto.create({ priority: 1 })).toEqual({ priority: 1 });
    expect(() => Dto.create({ priority: 99 })).toThrow();
  });

  // --- Edge cases: z.literal() unions ---

  it('should handle z.literal() unions', () => {
    const Schema = z.object({
      status: z.union([z.literal('active'), z.literal('inactive'), z.literal('pending')]),
    });
    class Dto extends createZodDto(Schema) {}

    expect(Dto.create({ status: 'active' })).toEqual({ status: 'active' });
    expect(() => Dto.create({ status: 'unknown' })).toThrow();
  });

  // --- Edge cases: .describe() metadata ---

  it('should handle schema with .describe() metadata', () => {
    const Schema = z.object({
      name: z.string().describe('The user name'),
    });
    class Dto extends createZodDto(Schema) {}

    expect(Dto.create({ name: 'Alice' })).toEqual({ name: 'Alice' });
    expect(Dto.schema).toBe(Schema);
  });

  // --- Edge cases: .pick() / .omit() / .partial() / .extend() ---

  it('should work with z.object().pick()', () => {
    const FullSchema = z.object({ name: z.string(), age: z.number(), email: z.string() });
    const PickedSchema = FullSchema.pick({ name: true, email: true });
    class Dto extends createZodDto(PickedSchema) {}

    expect(Dto.create({ name: 'Alice', email: 'a@b.com' })).toEqual({
      name: 'Alice',
      email: 'a@b.com',
    });
    // age should not be present even if passed
    const result = Dto.create({ name: 'Alice', email: 'a@b.com', age: 30 });
    expect((result as any).age).toBeUndefined();
  });

  it('should work with z.object().omit()', () => {
    const FullSchema = z.object({ name: z.string(), age: z.number(), secret: z.string() });
    const OmittedSchema = FullSchema.omit({ secret: true });
    class Dto extends createZodDto(OmittedSchema) {}

    expect(Dto.create({ name: 'Alice', age: 30 })).toEqual({ name: 'Alice', age: 30 });
  });

  it('should work with z.object().partial()', () => {
    const FullSchema = z.object({ name: z.string(), age: z.number() });
    const PartialSchema = FullSchema.partial();
    class Dto extends createZodDto(PartialSchema) {}

    expect(Dto.create({})).toEqual({});
    expect(Dto.create({ name: 'Alice' })).toEqual({ name: 'Alice' });
  });

  it('should work with z.object().extend()', () => {
    const BaseSchema = z.object({ name: z.string() });
    const ExtendedSchema = BaseSchema.extend({ role: z.string() });
    class Dto extends createZodDto(ExtendedSchema) {}

    expect(Dto.create({ name: 'Alice', role: 'admin' })).toEqual({
      name: 'Alice',
      role: 'admin',
    });
  });
});

describe('isZodDto', () => {
  it('should return true for ZodDto classes', () => {
    const Schema = z.object({ x: z.string() });
    class MyDto extends createZodDto(Schema) {}
    expect(isZodDto(MyDto)).toBe(true);
  });

  it('should return true for direct createZodDto result', () => {
    const Schema = z.object({ x: z.string() });
    const DtoClass = createZodDto(Schema);
    expect(isZodDto(DtoClass)).toBe(true);
  });

  it('should return false for regular classes', () => {
    class Regular {}
    expect(isZodDto(Regular)).toBe(false);
  });

  it('should return false for null', () => {
    expect(isZodDto(null)).toBe(false);
  });

  it('should return false for undefined', () => {
    expect(isZodDto(undefined)).toBe(false);
  });

  it('should return false for primitives', () => {
    expect(isZodDto('string')).toBe(false);
    expect(isZodDto(42)).toBe(false);
    expect(isZodDto(true)).toBe(false);
  });

  it('should return false for plain objects without isZodDto marker', () => {
    expect(isZodDto({ schema: z.object({}) })).toBe(false);
  });

  it('should return true for objects with isZodDto = true marker', () => {
    const fake = { isZodDto: true };
    expect(isZodDto(fake)).toBe(true);
  });
});

// ===========================================================================
// _OPENAPI_METADATA_FACTORY — Swagger property metadata generation
// ===========================================================================

describe('_OPENAPI_METADATA_FACTORY', () => {
  it('should return property metadata for z.object() schemas', () => {
    const Schema = z.object({ name: z.string(), age: z.number() });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY();

    expect(meta.name).toBeDefined();
    expect(meta.age).toBeDefined();
    expect((meta.name as any).required).toBe(true);
    expect((meta.name as any).type()).toBe(String);
    expect((meta.age as any).type()).toBe(Number);
  });

  it('should return empty object for z.union() schemas', () => {
    const Schema = z.union([z.string(), z.number()]).openapi('SomeUnion');
    const Dto = createZodDto(Schema);
    expect(Dto._OPENAPI_METADATA_FACTORY()).toEqual({});
  });

  it('should return empty object for z.discriminatedUnion() schemas', () => {
    const A = z.object({ t: z.literal('a') }).openapi('A');
    const B = z.object({ t: z.literal('b') }).openapi('B');
    const Schema = z.discriminatedUnion('t', [A, B]).openapi('AB');
    const Dto = createZodDto(Schema);
    expect(Dto._OPENAPI_METADATA_FACTORY()).toEqual({});
  });

  it('should mark optional fields as required: false', () => {
    const Schema = z.object({ bio: z.string().optional() });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.bio.required).toBe(false);
  });

  it('should mark nullable fields', () => {
    const Schema = z.object({ bio: z.string().nullable() });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.bio.nullable).toBe(true);
  });

  it('should include default values and mark as not required', () => {
    const Schema = z.object({ role: z.string().default('user') });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.role.default).toBe('user');
    expect(meta.role.required).toBe(false);
  });

  it('should detect string type', () => {
    const Schema = z.object({ name: z.string() });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.name.type()).toBe(String);
  });

  it('should detect number type', () => {
    const Schema = z.object({ count: z.number() });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.count.type()).toBe(Number);
  });

  it('should detect boolean type', () => {
    const Schema = z.object({ active: z.boolean() });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.active.type()).toBe(Boolean);
  });

  it('should include string constraints (minLength, maxLength)', () => {
    const Schema = z.object({ q: z.string().min(1).max(200) });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.q.minLength).toBe(1);
    expect(meta.q.maxLength).toBe(200);
  });

  it('should include number constraints (minimum, maximum)', () => {
    const Schema = z.object({ limit: z.number().min(1).max(100) });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.limit.minimum).toBe(1);
    expect(meta.limit.maximum).toBe(100);
  });

  it('should include enum values for z.enum()', () => {
    const Schema = z.object({ role: z.enum(['admin', 'user', 'guest']) });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.role.enum).toEqual(['admin', 'user', 'guest']);
  });

  it('should include enum values for z.nativeEnum()', () => {
    enum Status {
      Active = 'active',
      Inactive = 'inactive',
    }
    const Schema = z.object({ status: z.nativeEnum(Status) });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.status.enum).toEqual(expect.arrayContaining(['active', 'inactive']));
  });

  it('should handle z.coerce.number() (same as z.number())', () => {
    const Schema = z.object({ offset: z.coerce.number().int().min(0) });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.offset.type()).toBe(Number);
    expect(meta.offset.minimum).toBe(0);
  });

  it('should handle arrays', () => {
    const Schema = z.object({ tags: z.array(z.string()) });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.tags.isArray).toBe(true);
    // Array types return [Type] wrapper for NestJS Swagger compatibility
    const typeResult = meta.tags.type();
    expect(Array.isArray(typeResult)).toBe(true);
    expect(typeResult[0]).toBe(String);
  });

  it('should cache metadata across multiple calls', () => {
    const Schema = z.object({ x: z.string() });
    const Dto = createZodDto(Schema);
    const first = Dto._OPENAPI_METADATA_FACTORY();
    const second = Dto._OPENAPI_METADATA_FACTORY();
    expect(first).toBe(second); // same reference
  });

  it('should handle z.string().uuid() format and pattern', () => {
    const Schema = z.object({ id: z.string().uuid() });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.id.type()).toBe(String);
    expect(meta.id.format).toBe('uuid');
    expect(meta.id.pattern).toMatch(/^\^.*\$$/); // regex pattern present
  });

  it('should handle z.string().email() format', () => {
    const Schema = z.object({ email: z.string().email() });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.email.type()).toBe(String);
    expect(meta.email.format).toBe('email');
  });

  it('should handle nested objects as Object type', () => {
    const Inner = z.object({ x: z.number() });
    const Schema = z.object({ nested: Inner });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    // Non-named nested objects → Object
    expect(meta.nested.type()).toBe(Object);
  });

  it('should resolve $ref for named nested schemas', () => {
    const Named = z.object({ y: z.string() }).openapi('NamedNested');
    const Schema = z.object({ ref: Named });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    // Named schemas produce $ref → resolved to Object in metadata
    expect(meta.ref).toBeDefined();
    expect(meta.ref.type()).toBe(Object);
  });

  // --- z.coerce.* nullable fix ---

  it('z.coerce.date() should NOT be nullable', () => {
    const Schema = z.object({ at: z.coerce.date() });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.at.nullable).toBeFalsy();
  });

  it('z.coerce.date().nullable() SHOULD be nullable', () => {
    const Schema = z.object({ at: z.coerce.date().nullable() });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.at.nullable).toBe(true);
  });

  it('z.coerce.number() should NOT be nullable', () => {
    const Schema = z.object({ n: z.coerce.number() });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.n.nullable).toBeFalsy();
  });

  it('z.coerce.string() should NOT be nullable', () => {
    const Schema = z.object({ s: z.coerce.string() });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.s.nullable).toBeFalsy();
  });

  it('z.coerce.boolean() should NOT be nullable', () => {
    const Schema = z.object({ b: z.coerce.boolean() });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.b.nullable).toBeFalsy();
  });

  it('z.string().nullable() SHOULD be nullable', () => {
    const Schema = z.object({ s: z.string().nullable() });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.s.nullable).toBe(true);
  });

  // --- oneOf / anyOf handling (lines 277-278, 292-305) ---

  it('should handle nullable field producing oneOf with single non-null variant', () => {
    // z.string().nullable() produces oneOf: [{ type: 'string' }, { type: 'null' }]
    // This tests lines 292-305: single non-null variant unwrapping
    const Schema = z.object({
      name: z.string().nullable(),
    });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.name).toBeDefined();
    expect(meta.name.nullable).toBe(true);
    // Should be unwrapped to String type
    expect(meta.name.type()).toBe(String);
  });

  it('should handle nullable number producing oneOf with single non-null variant', () => {
    const Schema = z.object({
      count: z.number().nullable(),
    });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.count).toBeDefined();
    expect(meta.count.nullable).toBe(true);
    expect(meta.count.type()).toBe(Number);
  });

  it('should handle union (anyOf) with multiple non-null variants', () => {
    // z.union([z.string(), z.number()]) produces anyOf with 2 variants
    // lines 277-278, 304: multiple non-null variants -> Object type
    const Schema = z.object({
      value: z.union([z.string(), z.number()]),
    });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.value).toBeDefined();
    expect(meta.value.type()).toBe(Object);
  });

  it('should handle nullable union with multiple non-null variants', () => {
    // z.union([z.string(), z.number()]).nullable() produces anyOf with null variant
    const Schema = z.object({
      value: z.union([z.string(), z.number()]).nullable(),
    });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.value).toBeDefined();
    expect(meta.value.nullable).toBe(true);
    expect(meta.value.type()).toBe(Object);
  });

  // --- allOf single-item unwrap (line 310) ---

  it('should unwrap allOf with a single item', () => {
    // Using .extend() or .and() can produce allOf with one item in some generators
    // We test with an explicitly named schema that results in allOf
    const Inner = z.object({ x: z.string() }).openapi('AllOfInner');
    const Schema = z.object({
      ref: Inner,
    });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.ref).toBeDefined();
    // Named schema produces $ref which gets resolved
    expect(meta.ref.type()).toBe(Object);
  });

  // --- array without items (line 356) ---

  it('should handle array type without specific items', () => {
    const Schema = z.object({ data: z.array(z.any()) });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.data).toBeDefined();
    expect(meta.data.isArray).toBe(true);
    const typeResult = meta.data.type();
    expect(Array.isArray(typeResult)).toBe(true);
    expect(typeResult[0]).toBe(Object);
  });

  // --- extractZodPattern with format check (line 356 of create-zod-dto.ts) ---

  it('should extract pattern from z.string().uuid() inside optional wrapper', () => {
    const Schema = z.object({
      id: z.string().uuid().optional(),
    });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.id.format).toBe('uuid');
    expect(meta.id.pattern).toMatch(/^\^.*\$$/);
  });

  // --- buildSwaggerMetadata catch block (line 128) ---

  it('should return {} when buildSwaggerMetadata throws', () => {
    // Monkey-patch to simulate an error in generateComponents
    const zodToOpenapi = require('@asteasolutions/zod-to-openapi') as any;
    const origGenerate = zodToOpenapi.OpenApiGeneratorV3.prototype.generateComponents;

    // Temporarily make generateComponents throw
    zodToOpenapi.OpenApiGeneratorV3.prototype.generateComponents = () => {
      throw new Error('simulated failure');
    };

    try {
      // Create a fresh DTO (new cachedMetadata = null)
      const BrokenDto = createZodDto(z.object({ a: z.string() }));
      const meta = BrokenDto._OPENAPI_METADATA_FACTORY();
      // Should hit catch block and return {}
      expect(meta).toEqual({});
    } finally {
      // Restore
      zodToOpenapi.OpenApiGeneratorV3.prototype.generateComponents = origGenerate;
    }
  });

  it('should return {} when generateComponents returns no schemas', () => {
    // Monkey-patch to return components without schemas
    const zodToOpenapi = require('@asteasolutions/zod-to-openapi') as any;
    const origGenerate = zodToOpenapi.OpenApiGeneratorV3.prototype.generateComponents;

    zodToOpenapi.OpenApiGeneratorV3.prototype.generateComponents = () => ({
      components: { parameters: {} },
    });

    try {
      const NoSchemaDto = createZodDto(z.object({ a: z.string() }));
      const meta = NoSchemaDto._OPENAPI_METADATA_FACTORY();
      // No schemas → rootSchema is undefined → returns {}
      expect(meta).toEqual({});
    } finally {
      zodToOpenapi.OpenApiGeneratorV3.prototype.generateComponents = origGenerate;
    }
  });

  it('should return {} when generateComponents returns schema with non-object type', () => {
    // Monkey-patch to return a schema that is not type:'object'
    const zodToOpenapi = require('@asteasolutions/zod-to-openapi') as any;
    const origGenerate = zodToOpenapi.OpenApiGeneratorV3.prototype.generateComponents;

    zodToOpenapi.OpenApiGeneratorV3.prototype.generateComponents = () => ({
      components: {
        schemas: {
          __ZodDtoMeta__: { type: 'string' },
        },
      },
    });

    try {
      const StringDto = createZodDto(z.object({ a: z.string() }));
      const meta = StringDto._OPENAPI_METADATA_FACTORY();
      // type is 'string', not 'object' → returns {}
      expect(meta).toEqual({});
    } finally {
      zodToOpenapi.OpenApiGeneratorV3.prototype.generateComponents = origGenerate;
    }
  });

  it('should handle metadata when Zod schema has no shape (non-object passed to nullable/pattern checks)', () => {
    // Monkey-patch to return an object schema for a non-object Zod type.
    // This forces buildNullableKeySet/buildPatternMap to receive a schema
    // without a shape, covering the `!shape` return path.
    const zodToOpenapi = require('@asteasolutions/zod-to-openapi') as any;
    const origGenerate = zodToOpenapi.OpenApiGeneratorV3.prototype.generateComponents;

    zodToOpenapi.OpenApiGeneratorV3.prototype.generateComponents = () => ({
      components: {
        schemas: {
          __ZodDtoMeta__: {
            type: 'object',
            properties: { x: { type: 'string' } },
            required: ['x'],
          },
        },
      },
    });

    try {
      // Pass z.string() (non-object) to createZodDto — the Zod schema has no shape
      const FakeObjDto = createZodDto(z.string() as any);
      const meta = FakeObjDto._OPENAPI_METADATA_FACTORY();
      // The metadata factory should still work — nullable/pattern overrides are undefined
      expect(meta).toBeDefined();
      expect((meta as any).x).toBeDefined();
      expect((meta as any).x.type()).toBe(String);
    } finally {
      zodToOpenapi.OpenApiGeneratorV3.prototype.generateComponents = origGenerate;
    }
  });

  // --- description propagation ---

  it('should propagate description to metadata', () => {
    const Schema = z.object({
      name: z.string().describe('The user name'),
    });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.name.description).toBe('The user name');
  });

  // --- integer format ---

  it('should add int64 format for integer types', () => {
    const Schema = z.object({
      count: z.number().int(),
    });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.count.format).toBe('int64');
  });

  // --- exclusive constraints ---

  it('should include exclusiveMinimum for z.number().gt()', () => {
    const Schema = z.object({ score: z.number().gt(0) });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    // OpenAPI 3.0 style: exclusiveMinimum is a boolean, actual value is in minimum
    expect(meta.score.exclusiveMinimum).toBe(true);
    expect(meta.score.minimum).toBe(0);
  });

  it('should include exclusiveMaximum for z.number().lt()', () => {
    const Schema = z.object({ rate: z.number().lt(100) });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    // OpenAPI 3.0 style: exclusiveMaximum is a boolean, actual value is in maximum
    expect(meta.rate.exclusiveMaximum).toBe(true);
    expect(meta.rate.maximum).toBe(100);
  });

  // --- pattern from regex check directly in openapi output ---

  it('should propagate pattern from z.string().regex()', () => {
    const Schema = z.object({ code: z.string().regex(/^[A-Z]{3}$/) });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    // Regex pattern should be in the metadata
    expect(meta.code.pattern).toBe('^[A-Z]{3}$');
  });

  // --- anyOf with multiple non-null variants from buildSwaggerMetadata ---

  it('should handle union field where both variants are non-null', () => {
    const Schema = z.object({
      mixed: z.union([z.string(), z.number()]),
    });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.mixed).toBeDefined();
    // anyOf with 2 non-null variants → Object type
    expect(meta.mixed.type()).toBe(Object);
  });

  // --- nullable union with nullable: true variant ---

  it('should handle nullable union (anyOf with nullable variant)', () => {
    const Schema = z.object({
      value: z.union([z.string(), z.number()]).nullable(),
    });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.value).toBeDefined();
    expect(meta.value.nullable).toBe(true);
  });

  // --- z.unknown() field (no type in OpenAPI) ---

  it('should handle z.unknown() field (default type → Object)', () => {
    const Schema = z.object({
      data: z.unknown(),
    });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.data).toBeDefined();
    expect(meta.data.type()).toBe(Object);
  });

  // --- intersection field (allOf with multiple items) ---

  it('should handle z.intersection field (allOf)', () => {
    const A = z.object({ x: z.string() }).openapi('IntA');
    const Schema = z.object({
      merged: z.intersection(A, z.object({ y: z.number() })),
    });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.merged).toBeDefined();
  });

  // --- array of numbers ---

  it('should handle array of numbers', () => {
    const Schema = z.object({ nums: z.array(z.number()) });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.nums.isArray).toBe(true);
    const result = meta.nums.type();
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toBe(Number);
  });

  // --- array of booleans ---

  it('should handle array of booleans', () => {
    const Schema = z.object({ flags: z.array(z.boolean()) });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;
    expect(meta.flags.isArray).toBe(true);
    const result = meta.flags.type();
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toBe(Boolean);
  });

  // --- object with many constraint types ---

  it('should handle all constraint types together', () => {
    const Schema = z.object({
      name: z.string().min(1).max(100).describe('Name field'),
      score: z.number().min(0).max(100),
      level: z.number().int().gt(0).lt(10),
      active: z.boolean().default(true),
      uuid: z.string().uuid(),
      email: z.string().email(),
      role: z.enum(['admin', 'user']),
    });
    const Dto = createZodDto(Schema);
    const meta = Dto._OPENAPI_METADATA_FACTORY() as Record<string, any>;

    expect(meta.name.minLength).toBe(1);
    expect(meta.name.maxLength).toBe(100);
    expect(meta.name.description).toBe('Name field');
    expect(meta.score.minimum).toBe(0);
    expect(meta.score.maximum).toBe(100);
    expect(meta.level.exclusiveMinimum).toBe(true);
    expect(meta.level.exclusiveMaximum).toBe(true);
    expect(meta.active.default).toBe(true);
    expect(meta.uuid.format).toBe('uuid');
    expect(meta.email.format).toBe('email');
    expect(meta.role.enum).toEqual(['admin', 'user']);
  });
});
