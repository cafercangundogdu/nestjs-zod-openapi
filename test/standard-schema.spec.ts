import 'reflect-metadata';
import { getRefId } from '@asteasolutions/zod-to-openapi';
import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createStandardSchemaConverter,
  createZodDto,
  patchNestSwagger,
  ZodValidationPipe,
} from '../src';

/**
 * `@Body({ schema })` / `@Query({ schema })` / `@Param(name, { schema })` and
 * `@ApiOkResponse({ standardSchema })` only exist on NestJS 12. Applying those
 * decorators against NestJS 11 typings does not type-check (and `describe.skip`
 * still *executes* its callback), so the 12-only controllers are declared inside
 * `beforeAll` and every 12-only decorator goes through these loose helpers.
 */
const withSchema = (decorator: (...args: any[]) => ParameterDecorator, ...args: any[]) =>
  decorator(...args);

/** `true` when the installed NestJS is v12+ (`StandardSchemaValidationPipe` is 12-only). */
const isNest12 = 'StandardSchemaValidationPipe' in require('@nestjs/common');
const describeNest12 = isNest12 ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Shared schemas (plain Zod — safe to evaluate on NestJS 11 too)
// ---------------------------------------------------------------------------

const CustomerSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
  })
  .openapi('Customer');

const CreateOrderSchema = z
  .object({
    customer: CustomerSchema,
    placedAt: z.coerce.date(),
    note: z.string().nullable(),
    quantity: z.number().int().default(1),
  })
  .openapi('CreateOrder');

const OrderFiltersSchema = z
  .object({
    status: z.enum(['open', 'closed']).optional(),
    since: z.coerce.date().optional(),
    limit: z.coerce.number().int().default(20),
  })
  .openapi('OrderFilters');

const SearchQuerySchema = z.object({
  q: z.string(),
  page: z.coerce.number().optional(),
});

const OrderSchema = z
  .object({
    id: z.string().uuid(),
    total: z.number(),
  })
  .openapi('Order');

const LineItemSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('product'), sku: z.string() }).openapi('ProductLineItem'),
    z.object({ kind: z.literal('shipping'), carrier: z.string() }).openapi('ShippingLineItem'),
  ])
  .openapi('LineItem');

const SimpleSchema = z.object({ name: z.string() }).openapi('Simple');

class LegacyOrderDto extends createZodDto(z.object({ ref: z.string() })) {}

/** The temp ref id `createStandardSchemaConverter` uses for unnamed schemas. */
const INLINE_REF_ID = '__NestZodOpenApiInline__';

// ===========================================================================
// createStandardSchemaConverter — unit
// ===========================================================================

describe('createStandardSchemaConverter', () => {
  const convert = createStandardSchemaConverter();
  const input = { schemaType: 'input' } as const;

  describe('non-Zod input', () => {
    it('should return undefined for a plain object', () => {
      expect(convert({ foo: 'bar' }, input)).toBeUndefined();
    });

    it('should return undefined for a non-Zod Standard Schema (valibot-like)', () => {
      const valibotLike = {
        '~standard': { vendor: 'valibot', version: 1, validate() {} },
      };
      expect(convert(valibotLike, input)).toBeUndefined();
    });

    it('should return undefined for primitives, null and undefined', () => {
      expect(convert(undefined, input)).toBeUndefined();
      expect(convert(null, input)).toBeUndefined();
      expect(convert('CreateOrder', input)).toBeUndefined();
      expect(convert(42, input)).toBeUndefined();
    });
  });

  describe('unnamed schemas', () => {
    it('should inline an unnamed z.object', () => {
      const result = convert(SearchQuerySchema, input);

      expect(result?.schema).toEqual({
        type: 'object',
        properties: {
          q: { type: 'string' },
          page: { type: 'number' },
        },
        required: ['q'],
      });
    });

    it('should never leak the temporary inline ref id into components', () => {
      const result = convert(SearchQuerySchema, input);

      expect(result?.components).toBeDefined();
      expect(Object.keys(result?.components ?? {})).not.toContain(INLINE_REF_ID);
      expect(JSON.stringify(result)).not.toContain(INLINE_REF_ID);
    });

    it('should emit nested named schemas as components and $ref them', () => {
      const result = convert(z.object({ customer: CustomerSchema }), input);

      expect(result?.schema).toEqual({
        type: 'object',
        properties: { customer: { $ref: '#/components/schemas/Customer' } },
        required: ['customer'],
      });
      expect(result?.components?.Customer).toMatchObject({ type: 'object' });
      expect(Object.keys(result?.components ?? {})).toEqual(['Customer']);
    });
  });

  describe('named schemas', () => {
    it('should return a $ref plus the component for a .openapi() schema', () => {
      const result = convert(CreateOrderSchema, input);

      expect(result?.schema).toEqual({ $ref: '#/components/schemas/CreateOrder' });
      expect(result?.components?.CreateOrder).toBeDefined();
    });

    it('should also emit nested named components', () => {
      const result = convert(CreateOrderSchema, input);

      const createOrder = result?.components?.CreateOrder as any;

      expect(result?.components?.Customer).toBeDefined();
      expect(createOrder.properties.customer).toEqual({
        $ref: '#/components/schemas/Customer',
      });
    });

    it('should convert a named discriminatedUnion to oneOf + discriminator', () => {
      const result = convert(LineItemSchema, input);
      const component = result?.components?.LineItem as any;

      expect(result?.schema).toEqual({ $ref: '#/components/schemas/LineItem' });
      expect(component.oneOf).toEqual([
        { $ref: '#/components/schemas/ProductLineItem' },
        { $ref: '#/components/schemas/ShippingLineItem' },
      ]);
      expect(component.discriminator.propertyName).toBe('kind');
      expect(component.discriminator.mapping).toEqual({
        product: '#/components/schemas/ProductLineItem',
        shipping: '#/components/schemas/ShippingLineItem',
      });
      expect(result?.components?.ProductLineItem).toBeDefined();
      expect(result?.components?.ShippingLineItem).toBeDefined();
    });
  });

  describe('post-processing fixes', () => {
    it('should render z.coerce.date() as string/date-time without a spurious nullable', () => {
      const component = convert(CreateOrderSchema, input)?.components?.CreateOrder as any;

      expect(component.properties.placedAt).toEqual({ type: 'string', format: 'date-time' });
      expect(component.properties.placedAt.nullable).toBeUndefined();
    });

    it('should not mark an optional z.coerce.number() as nullable', () => {
      const component = convert(OrderFiltersSchema, input)?.components?.OrderFilters as any;

      expect(component.properties.since).toEqual({ type: 'string', format: 'date-time' });
      expect(component.properties.limit).toEqual({ type: 'integer', default: 20 });
      expect(component.properties.limit.nullable).toBeUndefined();
      expect(convert(SearchQuerySchema, input)?.schema).not.toHaveProperty('page.nullable');
    });

    it('should keep an explicit .nullable() field nullable', () => {
      const component = convert(CreateOrderSchema, input)?.components?.CreateOrder as any;

      expect(component.properties.note).toEqual({ type: 'string', nullable: true });
    });

    it('should enrich uuid / email formats with their regex pattern', () => {
      const component = convert(CustomerSchema, input)?.components?.Customer as any;

      expect(component.properties.id.format).toBe('uuid');
      expect(typeof component.properties.id.pattern).toBe('string');
      expect(component.properties.email.format).toBe('email');
      expect(typeof component.properties.email.pattern).toBe('string');
    });

    it('should enrich a scalar root schema (inlined parameter) with its pattern', () => {
      const schema = convert(z.string().uuid(), input)?.schema as any;

      expect(schema.type).toBe('string');
      expect(schema.format).toBe('uuid');
      expect(typeof schema.pattern).toBe('string');
      expect(schema).not.toHaveProperty('nullable');
    });

    it('should emit additionalProperties without nullable for a passthrough object', () => {
      const result = convert(z.object({ known: z.string() }).passthrough(), input);
      const schema = result?.schema as any;

      expect(schema.additionalProperties).toBeDefined();
      expect(schema.additionalProperties.nullable).toBeUndefined();
    });
  });

  describe('purity', () => {
    it('should be stable across calls and must not taint the caller schema', () => {
      const schema = z.object({ q: z.string(), page: z.coerce.number().optional() });

      expect(getRefId(schema as any)).toBeUndefined();
      const first = convert(schema, input);
      const second = convert(schema, input);

      expect(first).toEqual(second);
      expect(getRefId(schema as any)).toBeUndefined();
    });
  });

  describe('failure handling', () => {
    it('should warn and return undefined when generation throws', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // A bare z.custom() has no JSON Schema representation — generation throws.
      const unsupported = z.custom<symbol>((value) => typeof value === 'symbol');

      try {
        expect(convert(unsupported, input)).toBeUndefined();
        expect(warn).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });
});

// ===========================================================================
// ZodValidationPipe — metadata.schema (NestJS 12's `@Body({ schema })`)
// ===========================================================================

describe('ZodValidationPipe — metadata.schema', () => {
  const BodySchema = z.object({ name: z.string(), age: z.coerce.number() });

  it('should validate against metadata.schema and strip unknown keys', () => {
    const pipe = new ZodValidationPipe();

    const result = pipe.transform({ name: 'Alice', age: '30', extra: true }, {
      type: 'body',
      schema: BodySchema,
    } as any);

    expect(result).toEqual({ name: 'Alice', age: 30 });
  });

  it('should throw a structured BadRequestException for invalid input', () => {
    const pipe = new ZodValidationPipe();

    try {
      pipe.transform({ name: 42 }, { type: 'body', schema: BodySchema } as any);
      throw new Error('Expected BadRequestException');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse() as Record<string, any>;
      expect(response.statusCode).toBe(400);
      expect(response.message).toBe('Validation failed');
      expect(Array.isArray(response.errors)).toBe(true);
      expect(response.errors.length).toBeGreaterThan(0);
    }
  });

  it('should prefer metadata.schema over a ZodDto metatype', () => {
    class DtoWithOtherShape extends createZodDto(z.object({ other: z.string() })) {}
    const pipe = new ZodValidationPipe();

    const result = pipe.transform({ name: 'Bob', age: 7 }, {
      type: 'body',
      schema: BodySchema,
      metatype: DtoWithOtherShape,
    } as any);

    expect(result).toEqual({ name: 'Bob', age: 7 });
  });

  it('should prefer the constructor schema over metadata.schema', () => {
    const ConstructorSchema = z.object({ id: z.string() });
    const pipe = new ZodValidationPipe(ConstructorSchema);

    const result = pipe.transform({ id: 'abc', name: 'ignored' }, {
      type: 'body',
      schema: BodySchema,
    } as any);

    expect(result).toEqual({ id: 'abc' });
  });

  it('should pass a non-Zod Standard Schema through untouched', () => {
    const pipe = new ZodValidationPipe();
    const valibotLike = {
      '~standard': { vendor: 'valibot', version: 1, validate: () => ({ value: 'nope' }) },
    };
    const value = { anything: 'goes' };

    const result = pipe.transform(value, { type: 'body', schema: valibotLike } as any);

    expect(result).toBe(value);
  });

  it('should pass through when metadata.schema is absent and metatype is not a ZodDto', () => {
    const pipe = new ZodValidationPipe();
    const value = { anything: 'goes' };

    expect(pipe.transform(value, { type: 'body' } as any)).toBe(value);
  });
});

// ===========================================================================
// End-to-end document generation (NestJS 12 only)
// ===========================================================================

describeNest12('Standard Schema — Swagger document (NestJS 12)', () => {
  let doc: Record<string, any>;
  let docWithCustomConverter: Record<string, any>;

  beforeAll(async () => {
    @Controller('orders')
    class OrdersController {
      @Post()
      @ApiOkResponse({ standardSchema: OrderSchema } as any)
      create(@withSchema(Body, { schema: CreateOrderSchema }) body: unknown) {
        return body;
      }

      @Get()
      findAll(@withSchema(Query, { schema: OrderFiltersSchema }) filters: unknown) {
        return filters;
      }

      @Get('search')
      search(@withSchema(Query, { schema: SearchQuerySchema }) query: unknown) {
        return query;
      }

      @Post('line-items')
      addLineItem(@withSchema(Body, { schema: LineItemSchema }) item: unknown) {
        return item;
      }

      @Post('legacy')
      legacy(@Body() body: LegacyOrderDto) {
        return body;
      }

      @Get(':id')
      findOne(@withSchema(Param, 'id', { schema: z.string().uuid() }) id: string) {
        return id;
      }
    }

    patchNestSwagger();

    const moduleRef = await Test.createTestingModule({
      controllers: [OrdersController],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const config = new DocumentBuilder().setTitle('t').setVersion('1').build();

    doc = SwaggerModule.createDocument(app, config) as any;
    docWithCustomConverter = SwaggerModule.createDocument(app, config, {
      standardSchemaConverter: () => ({ schema: { type: 'string', description: 'custom' } }),
    } as any) as any;

    await app.close();
  });

  const paramsOf = (path: string, method = 'get'): any[] => doc.paths[path][method].parameters;
  const paramNamed = (path: string, name: string, method = 'get'): any =>
    paramsOf(path, method).find((param: any) => param.name === name);

  describe('request body from a named schema', () => {
    it('should reference the named component', () => {
      expect(doc.paths['/orders'].post.requestBody.content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/CreateOrder',
      });
    });

    it('should render z.coerce.date() as string/date-time without nullable', () => {
      const placedAt = doc.components.schemas.CreateOrder.properties.placedAt;

      expect(placedAt).toEqual({ type: 'string', format: 'date-time' });
    });

    it('should keep .nullable() fields nullable', () => {
      expect(doc.components.schemas.CreateOrder.properties.note.nullable).toBe(true);
    });

    it('should $ref the nested named Customer component', () => {
      expect(doc.components.schemas.CreateOrder.properties.customer).toEqual({
        $ref: '#/components/schemas/Customer',
      });

      const customer = doc.components.schemas.Customer;
      expect(customer.properties.id.format).toBe('uuid');
      expect(typeof customer.properties.id.pattern).toBe('string');
      expect(customer.properties.email.format).toBe('email');
      expect(typeof customer.properties.email.pattern).toBe('string');
    });

    it('should expose defaults and keep defaulted fields optional', () => {
      const createOrder = doc.components.schemas.CreateOrder;

      expect(createOrder.properties.quantity.default).toBe(1);
      expect(createOrder.required).not.toContain('quantity');
      expect(createOrder.required).toEqual(
        expect.arrayContaining(['customer', 'placedAt', 'note']),
      );
    });
  });

  describe('query parameters', () => {
    it('should expand a NAMED query object into individual parameters', () => {
      const names = paramsOf('/orders').map((param: any) => param.name);
      expect(names).toEqual(['status', 'since', 'limit']);

      expect(paramNamed('/orders', 'status')).toMatchObject({
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['open', 'closed'] },
      });
      expect(paramNamed('/orders', 'since')).toMatchObject({
        in: 'query',
        required: false,
        schema: { type: 'string', format: 'date-time' },
      });
      expect(paramNamed('/orders', 'since').schema.nullable).toBeUndefined();
      expect(paramNamed('/orders', 'limit')).toMatchObject({
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 20 },
      });
    });

    it('should expand an UNNAMED query object into individual parameters', () => {
      const names = paramsOf('/orders/search').map((param: any) => param.name);
      expect(names).toEqual(['q', 'page']);

      expect(paramNamed('/orders/search', 'q')).toMatchObject({
        in: 'query',
        required: true,
        schema: { type: 'string' },
      });
      expect(paramNamed('/orders/search', 'page')).toMatchObject({
        in: 'query',
        required: false,
        schema: { type: 'number' },
      });
      expect(paramNamed('/orders/search', 'page').schema.nullable).toBeUndefined();
    });
  });

  describe('path parameters', () => {
    it('should keep the scalar schema inline with format and pattern', () => {
      const id = paramNamed('/orders/{id}', 'id');

      expect(id).toMatchObject({ in: 'path', required: true });
      expect(id.schema.type).toBe('string');
      expect(id.schema.format).toBe('uuid');
      expect(typeof id.schema.pattern).toBe('string');
    });
  });

  describe('responses', () => {
    it('should $ref the named schema from @ApiOkResponse({ standardSchema })', () => {
      expect(doc.paths['/orders'].post.responses['200'].content['application/json'].schema).toEqual(
        { $ref: '#/components/schemas/Order' },
      );
      expect(doc.components.schemas.Order).toBeDefined();
    });
  });

  describe('discriminated union body', () => {
    it('should $ref a component holding oneOf + discriminator', () => {
      expect(
        doc.paths['/orders/line-items'].post.requestBody.content['application/json'].schema,
      ).toEqual({ $ref: '#/components/schemas/LineItem' });

      const lineItem = doc.components.schemas.LineItem;
      expect(lineItem.oneOf).toEqual([
        { $ref: '#/components/schemas/ProductLineItem' },
        { $ref: '#/components/schemas/ShippingLineItem' },
      ]);
      expect(lineItem.discriminator.propertyName).toBe('kind');
      expect(doc.components.schemas.ProductLineItem).toBeDefined();
      expect(doc.components.schemas.ShippingLineItem).toBeDefined();
    });
  });

  describe('coexistence with createZodDto()', () => {
    it('should still generate the classic DTO component', () => {
      expect(
        doc.paths['/orders/legacy'].post.requestBody.content['application/json'].schema,
      ).toEqual({ $ref: '#/components/schemas/LegacyOrderDto' });
      expect(doc.components.schemas.LegacyOrderDto.properties.ref).toEqual({ type: 'string' });
    });
  });

  describe('temporary inline ref id', () => {
    it('should not appear anywhere in the document', () => {
      expect(Object.keys(doc.components.schemas)).not.toContain(INLINE_REF_ID);
      expect(JSON.stringify(doc)).not.toContain(INLINE_REF_ID);
    });
  });

  describe('explicit standardSchemaConverter in createDocument()', () => {
    it('should be honored instead of the injected one', () => {
      expect(
        docWithCustomConverter.paths['/orders'].post.requestBody.content['application/json'].schema,
      ).toEqual({ type: 'string', description: 'custom' });
    });
  });
});

describeNest12('patchNestSwagger({ standardSchemaConverter: false }) (NestJS 12)', () => {
  let doc: Record<string, any>;

  beforeAll(async () => {
    @Controller('simple')
    class SimpleController {
      @Post()
      create(@withSchema(Body, { schema: SimpleSchema }) body: unknown) {
        return body;
      }
    }

    patchNestSwagger({ standardSchemaConverter: false });

    const moduleRef = await Test.createTestingModule({
      controllers: [SimpleController],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('t').setVersion('1').build(),
    ) as any;

    await app.close();
  });

  it('should leave NestJS built-in conversion in place (inline object, no $ref)', () => {
    const schema = doc.paths['/simple'].post.requestBody.content['application/json'].schema;

    expect(schema.$ref).toBeUndefined();
    expect(schema).toMatchObject({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });
    expect(doc.components.schemas.Simple).toBeUndefined();
  });
});
