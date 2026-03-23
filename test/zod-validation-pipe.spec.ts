import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { createZodDto, ZodValidationPipe } from '../src';

const UserSchema = z.object({
  name: z.string(),
  age: z.number(),
});

class UserDto extends createZodDto(UserSchema) {}

describe('ZodValidationPipe (global mode — no constructor arg)', () => {
  const pipe = new ZodValidationPipe();

  it('should validate body against DTO schema — passes valid input', () => {
    const value = { name: 'Alice', age: 30 };
    const result = pipe.transform(value, { type: 'body', metatype: UserDto });
    expect(result).toEqual({ name: 'Alice', age: 30 });
  });

  it('should reject invalid body — throws BadRequestException with structured errors', () => {
    const value = { name: 123 };
    try {
      pipe.transform(value, { type: 'body', metatype: UserDto });
      fail('Expected BadRequestException');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse() as Record<string, any>;
      expect(response.statusCode).toBe(400);
      expect(response.message).toBe('Validation failed');
      expect(Array.isArray(response.errors)).toBe(true);
      expect(response.errors.length).toBeGreaterThan(0);
    }
  });

  it('should pass through when no metatype (e.g. plain string param)', () => {
    const value = 'hello';
    const result = pipe.transform(value, { type: 'param' });
    expect(result).toBe('hello');
  });

  it('should pass through for non-ZodDto metatypes (regular class)', () => {
    class RegularClass {}
    const value = { data: 'test' };
    const result = pipe.transform(value, { type: 'body', metatype: RegularClass });
    expect(result).toEqual({ data: 'test' });
  });

  it('should work with query params', () => {
    const value = { name: 'Bob', age: 25 };
    const result = pipe.transform(value, { type: 'query', metatype: UserDto });
    expect(result).toEqual({ name: 'Bob', age: 25 });
  });

  it('should work with z.coerce transformations', () => {
    const CoerceSchema = z.object({
      port: z.coerce.number(),
    });
    class CoerceDto extends createZodDto(CoerceSchema) {}

    const value = { port: '3000' };
    const result = pipe.transform(value, { type: 'body', metatype: CoerceDto });
    expect(result).toEqual({ port: 3000 });
  });

  it('should reject empty body when schema requires fields', () => {
    expect(() => {
      pipe.transform({}, { type: 'body', metatype: UserDto });
    }).toThrow(BadRequestException);
  });

  it('should strip extra fields (default Zod behavior)', () => {
    const value = { name: 'Alice', age: 30, extra: 'field' };
    const result = pipe.transform(value, { type: 'body', metatype: UserDto });
    expect(result).toEqual({ name: 'Alice', age: 30 });
    expect((result as any).extra).toBeUndefined();
  });

  it('should keep extra fields when schema uses .passthrough()', () => {
    const PassthroughSchema = z
      .object({
        name: z.string(),
      })
      .passthrough();
    class PassthroughDto extends createZodDto(PassthroughSchema) {}

    const value = { name: 'Alice', extra: 'field' };
    const result = pipe.transform(value, { type: 'body', metatype: PassthroughDto });
    expect(result).toEqual({ name: 'Alice', extra: 'field' });
  });

  // --- Deep nested object validation ---

  it('should validate deeply nested objects', () => {
    const AddressSchema = z.object({
      street: z.string(),
      city: z.string(),
      geo: z.object({
        lat: z.number(),
        lng: z.number(),
      }),
    });
    const PersonSchema = z.object({
      name: z.string(),
      address: AddressSchema,
    });
    class PersonDto extends createZodDto(PersonSchema) {}

    const valid = {
      name: 'Alice',
      address: { street: '123 Main', city: 'Springfield', geo: { lat: 39.78, lng: -89.65 } },
    };
    expect(pipe.transform(valid, { type: 'body', metatype: PersonDto })).toEqual(valid);

    const invalid = {
      name: 'Alice',
      address: { street: '123 Main', city: 'Springfield', geo: { lat: 'not-a-number', lng: 0 } },
    };
    expect(() => pipe.transform(invalid, { type: 'body', metatype: PersonDto })).toThrow(
      BadRequestException,
    );
  });

  it('should validate nested objects with missing required fields', () => {
    const InnerSchema = z.object({ required: z.string() });
    const OuterSchema = z.object({ inner: InnerSchema });
    class OuterDto extends createZodDto(OuterSchema) {}

    expect(() => pipe.transform({ inner: {} }, { type: 'body', metatype: OuterDto })).toThrow(
      BadRequestException,
    );
  });

  // --- Array body validation ---

  it('should validate array body with raw schema in constructor', () => {
    const ArraySchema = z.array(z.object({ id: z.number(), name: z.string() }));
    const arrayPipe = new ZodValidationPipe(ArraySchema);

    const valid = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ];
    expect(arrayPipe.transform(valid, { type: 'body' })).toEqual(valid);

    const invalid = [{ id: 1, name: 'a' }, { id: 'not-number' }];
    expect(() => arrayPipe.transform(invalid, { type: 'body' })).toThrow(BadRequestException);
  });

  it('should validate array body via ZodDto', () => {
    const ItemSchema = z.object({ id: z.number() });
    const ListSchema = z.array(ItemSchema);
    const ListDto = createZodDto(ListSchema);

    const arrayPipe = new ZodValidationPipe(ListDto);

    expect(arrayPipe.transform([{ id: 1 }, { id: 2 }], { type: 'body' })).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    expect(() => arrayPipe.transform([{ id: 'x' }], { type: 'body' })).toThrow(BadRequestException);
  });

  // --- Optional / nullable / default in validation ---

  it('should accept undefined for optional fields', () => {
    const Schema = z.object({ name: z.string(), bio: z.string().optional() });
    class Dto extends createZodDto(Schema) {}

    const result = pipe.transform({ name: 'Alice' }, { type: 'body', metatype: Dto });
    expect(result).toEqual({ name: 'Alice' });
  });

  it('should accept null for nullable fields', () => {
    const Schema = z.object({ name: z.string(), bio: z.string().nullable() });
    class Dto extends createZodDto(Schema) {}

    const result = pipe.transform({ name: 'Alice', bio: null }, { type: 'body', metatype: Dto });
    expect(result).toEqual({ name: 'Alice', bio: null });
  });

  it('should apply default values during validation', () => {
    const Schema = z.object({ role: z.string().default('user'), name: z.string() });
    class Dto extends createZodDto(Schema) {}

    const result = pipe.transform({ name: 'Alice' }, { type: 'body', metatype: Dto });
    expect(result).toEqual({ role: 'user', name: 'Alice' });
  });
});

describe('ZodValidationPipe (per-parameter mode — constructor arg)', () => {
  it('should validate against a raw Zod schema passed to constructor', () => {
    const schema = z.object({ count: z.number() });
    const pipe = new ZodValidationPipe(schema);

    const result = pipe.transform({ count: 5 }, { type: 'body' });
    expect(result).toEqual({ count: 5 });

    expect(() => {
      pipe.transform({ count: 'not-a-number' }, { type: 'body' });
    }).toThrow(BadRequestException);
  });

  it('should validate against a ZodDto class passed to constructor', () => {
    const pipe = new ZodValidationPipe(UserDto);

    const result = pipe.transform({ name: 'Bob', age: 20 }, { type: 'body' });
    expect(result).toEqual({ name: 'Bob', age: 20 });

    expect(() => {
      pipe.transform({ name: 123 }, { type: 'body' });
    }).toThrow(BadRequestException);
  });

  it('should ignore metatype when constructor schema is provided', () => {
    const schema = z.object({ count: z.number() });
    const pipe = new ZodValidationPipe(schema);

    // Even though metatype is UserDto, the constructor schema takes precedence
    const result = pipe.transform({ count: 5 }, { type: 'body', metatype: UserDto });
    expect(result).toEqual({ count: 5 });
  });
});
