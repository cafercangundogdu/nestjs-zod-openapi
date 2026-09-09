import {
  type ArgumentMetadata,
  BadRequestException,
  Injectable,
  Optional,
  type PipeTransform,
} from '@nestjs/common';
import type { z } from 'zod';
import { isZodDto, type ZodDtoStatic } from './create-zod-dto.js';
import { isZodSchema } from './zod-introspection.js';

/**
 * Structured error format returned inside `BadRequestException`.
 */
export interface ZodValidationError {
  statusCode: 400;
  message: string;
  errors: z.core.$ZodIssue[];
}

/**
 * NestJS validation pipe that validates incoming data against a Zod schema.
 *
 * Usage:
 *
 * 1. **Global pipe** (validates any parameter whose type is a ZodDto, or — on
 *    NestJS 12 — that has a Zod schema attached via `@Body({ schema })`,
 *    `@Query({ schema })` or `@Param(name, { schema })`):
 *    ```ts
 *    app.useGlobalPipes(new ZodValidationPipe());
 *    ```
 *
 * 2. **Per-parameter pipe** (validates against a specific schema):
 *    ```ts
 *    @Body(new ZodValidationPipe(MySchema)) body: z.infer<typeof MySchema>
 *    ```
 *
 * Resolution order: constructor schema → schema attached to the parameter
 * decorator → ZodDto metatype → pass through. Standard Schemas from other
 * libraries (Valibot, ArkType, …) are passed through untouched; use NestJS 12's
 * `StandardSchemaValidationPipe` for those.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  private readonly schemaOrDto?: z.ZodType | ZodDtoStatic;

  constructor(@Optional() schemaOrDto?: z.ZodType | ZodDtoStatic) {
    this.schemaOrDto = schemaOrDto;
  }

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    // If a specific schema/dto was passed to the constructor, use it.
    if (this.schemaOrDto) {
      return this.validate(value, this.schemaOrDto);
    }

    // NestJS 12 attaches the decorator's `schema` option to the metadata. Read it
    // structurally so this also compiles against NestJS 11 typings, which lack it.
    const attachedSchema = (metadata as ArgumentMetadata & { schema?: unknown }).schema;
    if (isZodSchema(attachedSchema)) {
      return this.validate(value, attachedSchema);
    }

    // Otherwise, try to infer from the parameter's metatype.
    const { metatype } = metadata;
    if (!metatype || !isZodDto(metatype)) {
      // Not a ZodDto — pass through without validation.
      return value;
    }

    return this.validate(value, metatype.schema);
  }

  private validate(value: unknown, schemaOrDto: z.ZodType | ZodDtoStatic): unknown {
    const schema = isZodDto(schemaOrDto) ? schemaOrDto.schema : schemaOrDto;
    const result = schema.safeParse(value);

    if (result.success) {
      return result.data;
    }

    const zodError = result.error;
    throw new BadRequestException({
      statusCode: 400,
      message: 'Validation failed',
      errors: zodError.issues,
    } satisfies ZodValidationError);
  }
}
