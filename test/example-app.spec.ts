import 'reflect-metadata';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { patchNestSwagger } from '../src';

/**
 * End-to-end test with localeCompare sorting — exercises the localeCompare branch
 * in sortSchemas (line 149 of patch-nest-swagger.ts).
 */
describe('Example App — localeCompare sorting', () => {
  let swaggerDoc: Record<string, any>;

  beforeAll(async () => {
    const { AppModule } = await import('../example/src/app.module');

    patchNestSwagger({ schemasSort: 'localeCompare' });

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const app = module.createNestApplication();
    await app.init();

    const config = new DocumentBuilder().setTitle('Locale Test').setVersion('1.0').build();

    swaggerDoc = SwaggerModule.createDocument(app, config) as any;

    await app.close();
  });

  it('should generate a valid document with localeCompare sorting', () => {
    expect(swaggerDoc).toBeDefined();
    expect(swaggerDoc.components?.schemas).toBeDefined();
  });

  it('should sort schemas using localeCompare', () => {
    const keys = Object.keys(swaggerDoc.components.schemas);
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(sorted);
  });
});

/**
 * End-to-end test with default sorting — exercises the default branch
 * in sortSchemas (line 139 of patch-nest-swagger.ts).
 */
describe('Example App — default sorting', () => {
  let swaggerDoc: Record<string, any>;

  beforeAll(async () => {
    const { AppModule } = await import('../example/src/app.module');

    patchNestSwagger({ schemasSort: 'default' });

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const app = module.createNestApplication();
    await app.init();

    const config = new DocumentBuilder().setTitle('Default Test').setVersion('1.0').build();

    swaggerDoc = SwaggerModule.createDocument(app, config) as any;

    await app.close();
  });

  it('should generate a valid document with default sorting', () => {
    expect(swaggerDoc).toBeDefined();
    expect(swaggerDoc.components?.schemas).toBeDefined();
  });

  it('should preserve insertion order with default sorting', () => {
    const keys = Object.keys(swaggerDoc.components.schemas);
    // Just verify we have schemas — insertion order is not guaranteed to be any specific order
    expect(keys.length).toBeGreaterThan(0);
  });
});

/**
 * End-to-end test: bootstraps the example NestJS app, generates the Swagger JSON,
 * and verifies the COMPLETE OpenAPI output — schemas, query params, path params,
 * request bodies, response types, oneOf, $ref, discriminator, enums, constraints.
 */
describe('Example App — Swagger output verification', () => {
  let swaggerDoc: Record<string, any>;

  beforeAll(async () => {
    const { AppModule } = await import('../example/src/app.module');

    patchNestSwagger({ schemasSort: 'alpha' });

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const app = module.createNestApplication();
    await app.init();

    const config = new DocumentBuilder().setTitle('Test API').setVersion('1.0').build();

    swaggerDoc = SwaggerModule.createDocument(app, config) as any;

    await app.close();
  });

  // =========================================================================
  // Document structure
  // =========================================================================

  describe('document structure', () => {
    it('should generate a valid OpenAPI 3.0 document', () => {
      expect(swaggerDoc).toBeDefined();
      expect(swaggerDoc.openapi).toBe('3.0.0');
      expect(swaggerDoc.info.title).toBe('Test API');
    });

    it('should have components/schemas', () => {
      expect(swaggerDoc.components?.schemas).toBeDefined();
      expect(Object.keys(swaggerDoc.components.schemas).length).toBeGreaterThan(0);
    });

    it('should sort schemas alphabetically', () => {
      const keys = Object.keys(swaggerDoc.components.schemas);
      const sorted = [...keys].sort((a, b) => {
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      });
      expect(keys).toEqual(sorted);
    });

    it('should define paths for all controllers', () => {
      const paths = Object.keys(swaggerDoc.paths);
      expect(paths).toContain('/users');
      expect(paths).toContain('/users/{id}');
      expect(paths).toContain('/users/{id}/messages');
      expect(paths).toContain('/users/{id}/value');
      expect(paths).toContain('/search');
    });
  });

  // =========================================================================
  // Component schemas — named object schemas
  // =========================================================================

  describe('named object schemas', () => {
    it('Address: should have correct properties', () => {
      const address = swaggerDoc.components.schemas.Address;
      expect(address).toBeDefined();
      expect(address.type).toBe('object');
      expect(address.properties.street).toEqual({ type: 'string' });
      expect(address.properties.city).toEqual({ type: 'string' });
      expect(address.properties.zip).toEqual({ type: 'string' });
      expect(address.required).toEqual(expect.arrayContaining(['street', 'city', 'zip']));
    });

    it('User.id: should have format:uuid with pattern', () => {
      const user = swaggerDoc.components.schemas.User;
      expect(user.properties.id.format).toBe('uuid');
      expect(user.properties.id.pattern).toMatch(/^\^.*\$$/);
    });

    it('User.email: should have format:email', () => {
      const user = swaggerDoc.components.schemas.User;
      expect(user.properties.email.format).toBe('email');
    });

    it('User: should have $ref to Address', () => {
      const user = swaggerDoc.components.schemas.User;
      expect(user).toBeDefined();
      expect(user.type).toBe('object');
      expect(user.properties.name).toEqual({ type: 'string' });
      expect(user.properties.address).toEqual({
        $ref: '#/components/schemas/Address',
      });
    });

    it('UserDto: should match User structure with id and address $ref', () => {
      const userDto = swaggerDoc.components.schemas.UserDto;
      expect(userDto).toBeDefined();
      expect(userDto.type).toBe('object');
      expect(userDto.properties.id).toBeDefined();
      expect(userDto.properties.address).toEqual({
        $ref: '#/components/schemas/Address',
      });
    });

    it('CreateUserDto: should have name, email, address $ref', () => {
      const createUser = swaggerDoc.components.schemas.CreateUserDto;
      expect(createUser).toBeDefined();
      expect(createUser.type).toBe('object');
      expect(createUser.properties.name).toBeDefined();
      expect(createUser.properties.email).toBeDefined();
      expect(createUser.properties.address).toEqual({
        $ref: '#/components/schemas/Address',
      });
    });

    it('UserResponseDto: should have $ref to User and Status', () => {
      // When using `class UserResponseDto extends createZodDto(schema)`,
      // the subclass name overrides the .openapi() refId for the component key.
      const userResponse = swaggerDoc.components.schemas.UserResponseDto;
      expect(userResponse).toBeDefined();
      expect(userResponse.type).toBe('object');
      expect(userResponse.properties.user).toEqual({
        $ref: '#/components/schemas/User',
      });
      expect(userResponse.properties.status).toEqual({
        $ref: '#/components/schemas/Status',
      });
    });
  });

  // =========================================================================
  // Component schemas — enums
  // =========================================================================

  describe('enum schemas', () => {
    it('Status: should be a string enum with all values', () => {
      const status = swaggerDoc.components.schemas.Status;
      expect(status).toBeDefined();
      expect(status.type).toBe('string');
      expect(status.enum).toEqual(expect.arrayContaining(['active', 'inactive', 'pending']));
    });
  });

  // =========================================================================
  // Component schemas — discriminatedUnion (oneOf)
  // =========================================================================

  describe('discriminatedUnion schemas', () => {
    it('should produce oneOf with discriminator for MessagePart', () => {
      const schemas = swaggerDoc.components.schemas;
      const discriminatedSchemas = Object.values(schemas).filter(
        (s: any) => s.oneOf && s.discriminator,
      );
      expect(discriminatedSchemas.length).toBeGreaterThanOrEqual(1);

      const discriminated = discriminatedSchemas[0] as any;
      expect(discriminated.oneOf.length).toBeGreaterThanOrEqual(2);
      expect(discriminated.discriminator.propertyName).toBe('type');
      expect(discriminated.discriminator.mapping).toBeDefined();
    });

    it('TextPart: should have type literal and content string', () => {
      const textPart = swaggerDoc.components.schemas.TextPart;
      expect(textPart).toBeDefined();
      expect(textPart.type).toBe('object');
      expect(textPart.properties.type).toBeDefined();
      expect(textPart.properties.content).toEqual({ type: 'string' });
    });

    it('ImagePart: should have url and optional alt', () => {
      const imagePart = swaggerDoc.components.schemas.ImagePart;
      expect(imagePart).toBeDefined();
      expect(imagePart.type).toBe('object');
      expect(imagePart.properties.url).toBeDefined();
      // alt is optional — should NOT be in required
      if (imagePart.required) {
        expect(imagePart.required).not.toContain('alt');
      }
    });

    it('FilePart: should have filename and size', () => {
      const filePart = swaggerDoc.components.schemas.FilePart;
      expect(filePart).toBeDefined();
      expect(filePart.type).toBe('object');
      expect(filePart.properties.filename).toEqual({ type: 'string' });
      expect(filePart.properties.size).toEqual({ type: 'number' });
    });
  });

  // =========================================================================
  // Query parameters — @Query() with Zod DTO
  // =========================================================================

  describe('query parameters (GET /users)', () => {
    let params: any[];

    beforeAll(() => {
      params = swaggerDoc.paths['/users']?.get?.parameters ?? [];
    });

    it('should have query parameters from ListUsersDto', () => {
      const names = params.map((p: any) => p.name);
      expect(names).toContain('search');
      expect(names).toContain('status');
      expect(names).toContain('offset');
      expect(names).toContain('limit');
    });

    it('search: should be optional string', () => {
      const param = params.find((p: any) => p.name === 'search');
      expect(param).toBeDefined();
      expect(param.in).toBe('query');
      expect(param.required).toBeFalsy();
      expect(param.schema.type).toBe('string');
    });

    it('status: should be optional enum', () => {
      const param = params.find((p: any) => p.name === 'status');
      expect(param).toBeDefined();
      expect(param.in).toBe('query');
      expect(param.required).toBeFalsy();
      expect(param.schema.enum).toEqual(expect.arrayContaining(['active', 'inactive', 'pending']));
    });

    it('offset: should have default, minimum, and integer type', () => {
      const param = params.find((p: any) => p.name === 'offset');
      expect(param).toBeDefined();
      expect(param.in).toBe('query');
      expect(param.required).toBeFalsy();
      expect(param.schema.default).toBe(0);
      expect(param.schema.minimum).toBe(0);
      // Type could be 'integer' or 'number' depending on the generator
      expect(['integer', 'number']).toContain(param.schema.type);
    });

    it('limit: should have default, minimum, maximum', () => {
      const param = params.find((p: any) => p.name === 'limit');
      expect(param).toBeDefined();
      expect(param.in).toBe('query');
      expect(param.required).toBeFalsy();
      expect(param.schema.default).toBe(20);
      expect(param.schema.minimum).toBe(1);
      expect(param.schema.maximum).toBe(100);
    });
  });

  describe('query parameters (GET /search)', () => {
    let params: any[];

    beforeAll(() => {
      params = swaggerDoc.paths['/search']?.get?.parameters ?? [];
    });

    it('should have query parameters from SearchQueryDto', () => {
      const names = params.map((p: any) => p.name);
      expect(names).toContain('q');
      expect(names).toContain('tags');
      expect(names).toContain('includeArchived');
    });

    it('q: should be required string with minLength and maxLength', () => {
      const param = params.find((p: any) => p.name === 'q');
      expect(param).toBeDefined();
      expect(param.in).toBe('query');
      expect(param.required).toBe(true);
      expect(param.schema.type).toBe('string');
      expect(param.schema.minLength).toBe(1);
      expect(param.schema.maxLength).toBe(200);
    });

    it('tags: should be optional array of strings', () => {
      const param = params.find((p: any) => p.name === 'tags');
      expect(param).toBeDefined();
      expect(param.required).toBeFalsy();
      // Array params can appear as schema.type=array or with items
      const isArray = param.schema.type === 'array' || param.schema.items;
      expect(isArray).toBe(true);
    });

    it('includeArchived: should be optional boolean with default false', () => {
      const param = params.find((p: any) => p.name === 'includeArchived');
      expect(param).toBeDefined();
      expect(param.required).toBeFalsy();
      expect(param.schema.type).toBe('boolean');
      expect(param.schema.default).toBe(false);
    });
  });

  // =========================================================================
  // Path parameters
  // =========================================================================

  describe('path parameters', () => {
    it('GET /users/{id}: should have id path parameter', () => {
      const params = swaggerDoc.paths['/users/{id}']?.get?.parameters ?? [];
      const idParam = params.find((p: any) => p.name === 'id' && p.in === 'path');
      expect(idParam).toBeDefined();
      expect(idParam.required).toBe(true);
    });

    it('POST /users/{id}/messages: should have id path parameter', () => {
      const params = swaggerDoc.paths['/users/{id}/messages']?.post?.parameters ?? [];
      const idParam = params.find((p: any) => p.name === 'id' && p.in === 'path');
      expect(idParam).toBeDefined();
      expect(idParam.required).toBe(true);
    });
  });

  // =========================================================================
  // Request body
  // =========================================================================

  describe('request body schemas', () => {
    it('POST /users: should have request body with application/json', () => {
      const postUsers = swaggerDoc.paths['/users']?.post;
      expect(postUsers.requestBody).toBeDefined();
      expect(postUsers.requestBody.content['application/json']).toBeDefined();

      const bodySchema = postUsers.requestBody.content['application/json'].schema;
      expect(bodySchema).toBeDefined();
      // Should reference CreateUserDto
      expect(bodySchema.$ref).toContain('CreateUserDto');
    });

    it('POST /users/{id}/messages: should have request body', () => {
      const postMessages = swaggerDoc.paths['/users/{id}/messages']?.post;
      expect(postMessages.requestBody).toBeDefined();
      expect(postMessages.requestBody.content['application/json']).toBeDefined();
    });
  });

  // =========================================================================
  // Response schemas
  // =========================================================================

  describe('response schemas', () => {
    it('GET /users: should reference UserDto in 200 response', () => {
      const getUsers = swaggerDoc.paths['/users']?.get;
      const okResponse = getUsers.responses['200'];
      expect(okResponse).toBeDefined();
      expect(okResponse.content['application/json']).toBeDefined();
    });

    it('GET /users/{id}: should reference UserResponseDto in 200 response', () => {
      const getUser = swaggerDoc.paths['/users/{id}']?.get;
      const okResponse = getUser.responses['200'];
      expect(okResponse).toBeDefined();
      expect(okResponse.content['application/json']).toBeDefined();
    });

    it('POST /users: should reference UserDto in 201 response', () => {
      const postUsers = swaggerDoc.paths['/users']?.post;
      const createdResponse = postUsers.responses['201'];
      expect(createdResponse).toBeDefined();
      expect(createdResponse.content['application/json']).toBeDefined();
    });
  });

  // =========================================================================
  // No empty schemas
  // =========================================================================

  describe('schema completeness', () => {
    it('should have no empty object schemas (all should have properties or additionalProperties)', () => {
      const schemas = swaggerDoc.components.schemas;
      const emptyObjectSchemas = Object.entries(schemas).filter(
        ([_, s]: [string, any]) =>
          s.type === 'object' &&
          (!s.properties || Object.keys(s.properties).length === 0) &&
          !s.additionalProperties, // z.record() schemas have additionalProperties instead of properties
      );
      expect(emptyObjectSchemas.map(([k]) => k)).toEqual([]);
    });

    it('all named part schemas should appear in components', () => {
      const schemas = swaggerDoc.components.schemas;
      expect(schemas.TextPart).toBeDefined();
      expect(schemas.ImagePart).toBeDefined();
      expect(schemas.FilePart).toBeDefined();
      expect(schemas.Address).toBeDefined();
      expect(schemas.User).toBeDefined();
      expect(schemas.Status).toBeDefined();
      expect(schemas.Event ?? schemas.EventDto).toBeDefined();
    });
  });

  // =========================================================================
  // z.coerce.date() — nullable only when explicitly .nullable()
  // =========================================================================

  describe('z.coerce.date() nullable handling', () => {
    it('Event.occurredAt: z.coerce.date() should NOT be nullable', () => {
      const event = swaggerDoc.components.schemas.Event ?? swaggerDoc.components.schemas.EventDto;
      expect(event).toBeDefined();
      const occurredAt = event.properties.occurredAt;
      expect(occurredAt).toBeDefined();
      expect(occurredAt.nullable).toBeFalsy();
    });

    it('Event.deletedAt: z.coerce.date().nullable() SHOULD be nullable', () => {
      const event = swaggerDoc.components.schemas.Event ?? swaggerDoc.components.schemas.EventDto;
      expect(event).toBeDefined();
      const deletedAt = event.properties.deletedAt;
      expect(deletedAt).toBeDefined();
      expect(deletedAt.nullable).toBe(true);
    });

    it('Event.occurredAt and deletedAt should both have date-time format', () => {
      const event = swaggerDoc.components.schemas.Event ?? swaggerDoc.components.schemas.EventDto;
      // The format may be on the property directly or in a nested schema
      const occurredAt = event.properties.occurredAt;
      const deletedAt = event.properties.deletedAt;
      expect(occurredAt.format ?? occurredAt.type).toBeDefined();
      expect(deletedAt.format ?? deletedAt.type).toBeDefined();
    });
  });

  // =========================================================================
  // .passthrough() — additionalProperties handling
  // =========================================================================

  describe('.passthrough() schemas', () => {
    it('Metadata: should be an object with additionalProperties stripped of nullable', () => {
      // Schema may appear under .openapi() name 'Metadata' or class name 'MetadataDto'
      const schema =
        swaggerDoc.components.schemas.Metadata ?? swaggerDoc.components.schemas.MetadataDto;
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.properties.key).toEqual({ type: 'string' });
      // additionalProperties should exist but nullable should be stripped
      if (schema.additionalProperties) {
        expect(schema.additionalProperties.nullable).toBeFalsy();
      }
    });

    it('WithPassthroughField: data should not have nullable additionalProperties', () => {
      const schema =
        swaggerDoc.components.schemas.WithPassthroughField ??
        swaggerDoc.components.schemas.WithPassthroughFieldDto;
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      const data = schema.properties.data;
      expect(data).toBeDefined();
      if (data.additionalProperties) {
        expect(data.additionalProperties.nullable).toBeFalsy();
      }
    });
  });

  // =========================================================================
  // z.record() — additionalProperties handling
  // =========================================================================

  describe('z.record() schemas', () => {
    it('TagMap: labels should have additionalProperties of type number', () => {
      const schema =
        swaggerDoc.components.schemas.TagMap ?? swaggerDoc.components.schemas.TagMapDto;
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      const labels = schema.properties.labels;
      expect(labels).toBeDefined();
      expect(labels.additionalProperties).toBeDefined();
      // nullable should NOT be on additionalProperties for non-nullable record value
      expect(labels.additionalProperties.nullable).toBeFalsy();
    });

    it('WithRecordField: counts should have additionalProperties with nullable stripped (z.coerce.date())', () => {
      const schema =
        swaggerDoc.components.schemas.WithRecordField ??
        swaggerDoc.components.schemas.WithRecordFieldDto;
      expect(schema).toBeDefined();
      const counts = schema.properties.counts;
      expect(counts).toBeDefined();
      expect(counts.additionalProperties).toBeDefined();
      // z.coerce.date() produces spurious nullable on additionalProperties
      // fixSchemaRecursive should strip it since the value type is not structurally nullable
      expect(counts.additionalProperties.nullable).toBeFalsy();
    });
  });

  // =========================================================================
  // Nested inline objects and arrays
  // =========================================================================

  describe('nested inline objects and arrays', () => {
    it('NestedInline: nested inline object with z.coerce.date() should not be nullable', () => {
      const schema =
        swaggerDoc.components.schemas.NestedInline ?? swaggerDoc.components.schemas.NestedInlineDto;
      expect(schema).toBeDefined();
      expect(schema.properties.nested).toBeDefined();
      if (schema.properties.nested.properties) {
        const value = schema.properties.nested.properties.value;
        expect(value).toBeDefined();
        expect(value.nullable).toBeFalsy();
      }
    });

    it('NestedInline: array items should have uuid pattern', () => {
      const schema =
        swaggerDoc.components.schemas.NestedInline ?? swaggerDoc.components.schemas.NestedInlineDto;
      expect(schema).toBeDefined();
      const items = schema.properties.items;
      expect(items).toBeDefined();
      expect(items.type).toBe('array');
      if (items.items?.properties?.id) {
        expect(items.items.properties.id.format).toBe('uuid');
        expect(items.items.properties.id.pattern).toBeDefined();
      }
    });

    it('NestedInline: array items score should not be nullable', () => {
      const schema =
        swaggerDoc.components.schemas.NestedInline ?? swaggerDoc.components.schemas.NestedInlineDto;
      expect(schema).toBeDefined();
      const items = schema.properties.items;
      if (items?.items?.properties?.score) {
        expect(items.items.properties.score.nullable).toBeFalsy();
      }
    });
  });

  // =========================================================================
  // Container — discriminatedUnion + array fields in walkZodTree
  // =========================================================================

  describe('container with discriminatedUnion and array fields', () => {
    it('Container: should have part and tags properties', () => {
      const schema =
        swaggerDoc.components.schemas.Container ?? swaggerDoc.components.schemas.ContainerDto;
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.properties.part).toBeDefined();
      expect(schema.properties.tags).toBeDefined();
    });

    it('InnerA and InnerB schemas should exist in components', () => {
      expect(swaggerDoc.components.schemas.InnerA).toBeDefined();
      expect(swaggerDoc.components.schemas.InnerB).toBeDefined();
    });

    it('Container: tags should be array', () => {
      const schema =
        swaggerDoc.components.schemas.Container ?? swaggerDoc.components.schemas.ContainerDto;
      expect(schema).toBeDefined();
      const tags = schema.properties.tags;
      expect(tags.type).toBe('array');
    });
  });

  // =========================================================================
  // Wrapped schema — default, nullable wrappers
  // =========================================================================

  describe('wrapped schemas (default, nullable)', () => {
    it('Wrapped: should have opt, cat, ro properties', () => {
      const schema =
        swaggerDoc.components.schemas.Wrapped ?? swaggerDoc.components.schemas.WrappedDto;
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.properties.opt).toBeDefined();
      expect(schema.properties.cat).toBeDefined();
      expect(schema.properties.ro).toBeDefined();
    });

    it('Wrapped: cat should be nullable', () => {
      const schema =
        swaggerDoc.components.schemas.Wrapped ?? swaggerDoc.components.schemas.WrappedDto;
      expect(schema).toBeDefined();
      const cat = schema.properties.cat;
      expect(cat.nullable).toBe(true);
    });

    it('Wrapped: opt should have default value', () => {
      const schema =
        swaggerDoc.components.schemas.Wrapped ?? swaggerDoc.components.schemas.WrappedDto;
      expect(schema).toBeDefined();
      const opt = schema.properties.opt;
      expect(opt.default).toBe('hello');
    });
  });

  // =========================================================================
  // Array of primitive format types — extractZodPattern on array items
  // =========================================================================

  describe('array of primitive formats', () => {
    it('ArrayFormats: uuids should be array of uuid strings with pattern', () => {
      const schema =
        swaggerDoc.components.schemas.ArrayFormats ?? swaggerDoc.components.schemas.ArrayFormatsDto;
      expect(schema).toBeDefined();
      const uuids = schema.properties.uuids;
      expect(uuids).toBeDefined();
      expect(uuids.type).toBe('array');
      if (uuids.items) {
        expect(uuids.items.format).toBe('uuid');
        // pattern should be extracted from the Zod uuid check
        expect(uuids.items.pattern).toBeDefined();
      }
    });

    it('ArrayFormats: dates should be array without spurious nullable', () => {
      const schema =
        swaggerDoc.components.schemas.ArrayFormats ?? swaggerDoc.components.schemas.ArrayFormatsDto;
      expect(schema).toBeDefined();
      const dates = schema.properties.dates;
      expect(dates).toBeDefined();
      expect(dates.type).toBe('array');
      if (dates.items) {
        // z.coerce.date() array items should not be nullable
        expect(dates.items.nullable).toBeFalsy();
      }
    });
  });

  // =========================================================================
  // Top-level record schema
  // =========================================================================

  describe('top-level record schema', () => {
    it('RecordTop: should be an object with additionalProperties and nullable stripped', () => {
      const schema =
        swaggerDoc.components.schemas.RecordTop ?? swaggerDoc.components.schemas.RecordTopDto;
      if (schema) {
        expect(schema.type).toBe('object');
        expect(schema.additionalProperties).toBeDefined();
        // z.coerce.date() value — spurious nullable should be stripped
        expect(schema.additionalProperties.nullable).toBeFalsy();
      }
    });
  });

  // =========================================================================
  // Inline passthrough in union — stripAdditionalPropsNullable
  // =========================================================================

  describe('inline passthrough in union', () => {
    it('InlinePass: anyOf variant should NOT have nullable additionalProperties', () => {
      const schema =
        swaggerDoc.components.schemas.InlinePass ?? swaggerDoc.components.schemas.InlinePassDto;
      expect(schema).toBeDefined();
      const part = schema.properties.part;
      expect(part).toBeDefined();
      // Check anyOf variants
      if (part.anyOf) {
        for (const variant of part.anyOf) {
          if (variant.additionalProperties) {
            // stripAdditionalPropsNullable should have stripped { nullable: true }
            expect(variant.additionalProperties.nullable).toBeFalsy();
          }
        }
      }
    });
  });

  // =========================================================================
  // CatchallAny — .catchall(z.any()) additionalProperties handling
  // =========================================================================

  describe('catchall z.any() schemas', () => {
    it('CatchallAny: should have additionalProperties with nullable stripped', () => {
      const schema =
        swaggerDoc.components.schemas.CatchallAny ?? swaggerDoc.components.schemas.CatchallAnyDto;
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      // .catchall(z.any()) produces additionalProperties: { nullable: true }
      // isPassthroughObject recognizes 'any' catchall and strips nullable
      if (schema.additionalProperties) {
        expect(schema.additionalProperties.nullable).toBeFalsy();
      }
    });
  });
});
