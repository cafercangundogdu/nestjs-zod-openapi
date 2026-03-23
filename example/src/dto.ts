import { z } from 'zod';
import { createZodDto } from '../../src';

// ---------------------------------------------------------------------------
// Named schemas (appear in components/schemas via .openapi('Name'))
// ---------------------------------------------------------------------------

export const AddressSchema = z
  .object({
    street: z.string(),
    city: z.string(),
    zip: z.string(),
  })
  .openapi('Address');

export const UserSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
    address: AddressSchema,
  })
  .openapi('User');

// ---------------------------------------------------------------------------
// nativeEnum
// ---------------------------------------------------------------------------

export enum Status {
  Active = 'active',
  Inactive = 'inactive',
  Pending = 'pending',
}

export const StatusSchema = z.nativeEnum(Status).openapi('Status');

// ---------------------------------------------------------------------------
// discriminatedUnion — produces oneOf with discriminator
// ---------------------------------------------------------------------------

export const TextPartSchema = z
  .object({
    type: z.literal('text'),
    content: z.string(),
  })
  .openapi('TextPart');

export const ImagePartSchema = z
  .object({
    type: z.literal('image'),
    url: z.string().url(),
    alt: z.string().optional(),
  })
  .openapi('ImagePart');

export const FilePartSchema = z
  .object({
    type: z.literal('file'),
    filename: z.string(),
    size: z.number(),
  })
  .openapi('FilePart');

export const MessagePartSchema = z
  .discriminatedUnion('type', [TextPartSchema, ImagePartSchema, FilePartSchema])
  .openapi('MessagePart');

// ---------------------------------------------------------------------------
// union — produces anyOf
// ---------------------------------------------------------------------------

export const StringOrNumberSchema = z.union([z.string(), z.number()]).openapi('StringOrNumber');

// ---------------------------------------------------------------------------
// Query DTOs — test @Query() parameter discovery
// ---------------------------------------------------------------------------

export const ListUsersSchema = z.object({
  search: z.string().optional(),
  status: z.nativeEnum(Status).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export class ListUsersDto extends createZodDto(ListUsersSchema) {}

export const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  tags: z.array(z.string()).optional(),
  includeArchived: z.coerce.boolean().default(false),
});
export class SearchQueryDto extends createZodDto(SearchQuerySchema) {}

// ---------------------------------------------------------------------------
// DTO classes
// ---------------------------------------------------------------------------

export class UserDto extends createZodDto(UserSchema) {}

export const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  address: AddressSchema,
});
export class CreateUserDto extends createZodDto(CreateUserSchema) {}

// For discriminatedUnion / union schemas, use direct assignment instead of
// `extends` because the output type is a union, not a single object type.
// Export a companion type for type-position usage (body param, return type).
export const MessagePartDto = createZodDto(MessagePartSchema);
export type MessagePartInput = z.output<typeof MessagePartSchema>;

export const StringOrNumberDto = createZodDto(StringOrNumberSchema);
export type StringOrNumberInput = z.output<typeof StringOrNumberSchema>;

export const UserResponseSchema = z
  .object({
    user: UserSchema,
    status: StatusSchema,
  })
  .openapi('UserResponse');
export class UserResponseDto extends createZodDto(UserResponseSchema) {}

// ---------------------------------------------------------------------------
// z.coerce.date() test — should NOT be nullable unless explicitly .nullable()
// ---------------------------------------------------------------------------

export const EventSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    occurredAt: z.coerce.date(),
    deletedAt: z.coerce.date().nullable(),
  })
  .openapi('Event');
export class EventDto extends createZodDto(EventSchema) {}

// ---------------------------------------------------------------------------
// .passthrough() — tests additionalProperties nullable stripping
// ---------------------------------------------------------------------------

export const MetadataSchema = z
  .object({
    key: z.string(),
  })
  .passthrough()
  .openapi('Metadata');
export class MetadataDto extends createZodDto(MetadataSchema) {}

// ---------------------------------------------------------------------------
// z.record() — tests record value type additionalProperties handling
// ---------------------------------------------------------------------------

export const TagMapSchema = z
  .object({
    labels: z.record(z.string(), z.number()),
  })
  .openapi('TagMap');
export class TagMapDto extends createZodDto(TagMapSchema) {}

// ---------------------------------------------------------------------------
// Nested inline object + array of objects with format checks
// ---------------------------------------------------------------------------

export const NestedInlineSchema = z
  .object({
    nested: z.object({
      value: z.coerce.date(),
    }),
    items: z.array(
      z.object({
        id: z.string().uuid(),
        score: z.coerce.number(),
      }),
    ),
  })
  .openapi('NestedInline');
export class NestedInlineDto extends createZodDto(NestedInlineSchema) {}

// ---------------------------------------------------------------------------
// Union inside an object field — tests walkZodTree union options
// ---------------------------------------------------------------------------

export const InnerASchema = z.object({ kind: z.literal('a'), val: z.string() }).openapi('InnerA');
export const InnerBSchema = z.object({ kind: z.literal('b'), num: z.number() }).openapi('InnerB');

export const ContainerSchema = z
  .object({
    part: z.discriminatedUnion('kind', [InnerASchema, InnerBSchema]),
    tags: z.array(InnerASchema),
  })
  .openapi('Container');
export class ContainerDto extends createZodDto(ContainerSchema) {}

// ---------------------------------------------------------------------------
// Nested passthrough inside object field
// ---------------------------------------------------------------------------

export const WithPassthroughFieldSchema = z
  .object({
    data: z.object({ x: z.string() }).passthrough(),
  })
  .openapi('WithPassthroughField');
export class WithPassthroughFieldDto extends createZodDto(WithPassthroughFieldSchema) {}

// ---------------------------------------------------------------------------
// Nested record inside object field
// ---------------------------------------------------------------------------

export const WithRecordFieldSchema = z
  .object({
    counts: z.record(z.string(), z.coerce.date()),
  })
  .openapi('WithRecordField');
export class WithRecordFieldDto extends createZodDto(WithRecordFieldSchema) {}

// ---------------------------------------------------------------------------
// Optional wrapper around default to test isStructurallyNullable passthrough
// ---------------------------------------------------------------------------

export const WrappedSchema = z
  .object({
    opt: z.string().default('hello').optional(),
    cat: z.string().nullable(),
    ro: z.string(),
  })
  .openapi('Wrapped');
export class WrappedDto extends createZodDto(WrappedSchema) {}

// ---------------------------------------------------------------------------
// Array of primitive formats — tests extractZodPattern on array items (lines 288, 291-292)
// ---------------------------------------------------------------------------

export const ArrayFormatsSchema = z
  .object({
    uuids: z.array(z.string().uuid()),
    dates: z.array(z.coerce.date()),
  })
  .openapi('ArrayFormats');
export class ArrayFormatsDto extends createZodDto(ArrayFormatsSchema) {}

// ---------------------------------------------------------------------------
// Top-level record schema — tests fixSchemaRecursive root record handling (line 237)
// ---------------------------------------------------------------------------

export const RecordTopSchema = z.record(z.string(), z.coerce.date()).openapi('RecordTop');
export const RecordTopDto = createZodDto(RecordTopSchema);

// ---------------------------------------------------------------------------
// Coerced date with default — tests isStructurallyNullable passthrough (lines 408-409)
// The generator marks z.coerce.date() as nullable, and isStructurallyNullable
// must traverse the 'default' wrapper to check whether it's truly nullable.
// ---------------------------------------------------------------------------

export const DefaultDateSchema = z
  .object({
    createdAt: z.coerce.date().default(new Date('2020-01-01')),
    updatedAt: z.coerce.date().optional(),
  })
  .openapi('DefaultDate');
export class DefaultDateDto extends createZodDto(DefaultDateSchema) {}

// ---------------------------------------------------------------------------
// Inline passthrough inside union — tests stripAdditionalPropsNullable (lines 444-446)
// The inline variant has additionalProperties: { nullable: true } which can't be
// reached by fixSchemaRecursive (it doesn't recurse into anyOf variants).
// ---------------------------------------------------------------------------

export const InlinePassSchema = z
  .object({
    part: z.union([z.string(), z.object({ data: z.string() }).passthrough()]),
  })
  .openapi('InlinePass');
export class InlinePassDto extends createZodDto(InlinePassSchema) {}

// ---------------------------------------------------------------------------
// .catchall(z.any()) — tests isPassthroughObject 'any' branch (line 373)
// ---------------------------------------------------------------------------

export const CatchallAnySchema = z
  .object({
    key: z.string(),
  })
  .catchall(z.any())
  .openapi('CatchallAny');
export class CatchallAnyDto extends createZodDto(CatchallAnySchema) {}
