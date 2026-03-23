import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import {
  ArrayFormatsDto,
  CatchallAnyDto,
  ContainerDto,
  CreateUserDto,
  DefaultDateDto,
  EventDto,
  InlinePassDto,
  ListUsersDto,
  MessagePartDto,
  type MessagePartInput,
  MetadataDto,
  NestedInlineDto,
  RecordTopDto,
  SearchQueryDto,
  StringOrNumberDto,
  type StringOrNumberInput,
  TagMapDto,
  UserDto,
  UserResponseDto,
  WithPassthroughFieldDto,
  WithRecordFieldDto,
  WrappedDto,
} from './dto';

@Controller('users')
export class AppController {
  @Get()
  @ApiOkResponse({ type: UserDto, isArray: true })
  async listUsers(@Query() _query: ListUsersDto): Promise<UserDto[]> {
    return [];
  }

  @Get(':id')
  @ApiOkResponse({ type: UserResponseDto })
  async getUser(@Param('id') _id: string): Promise<UserResponseDto> {
    return UserResponseDto.create({
      user: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Alice',
        email: 'alice@example.com',
        address: { street: '123 Main St', city: 'Springfield', zip: '62701' },
      },
      status: 'active',
    });
  }

  @Post()
  @ApiCreatedResponse({ type: UserDto })
  async createUser(@Body() body: CreateUserDto): Promise<UserDto> {
    return UserDto.create({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: body.name,
      email: body.email,
      address: body.address,
    });
  }

  // Union/discriminatedUnion DTOs: use InstanceType<typeof Dto> for body type
  // annotation since union output types can't be used directly as class types.
  // The DTO class still works for @ApiCreatedResponse and ZodValidationPipe.
  @Post(':id/messages')
  @ApiBody({ type: MessagePartDto })
  @ApiCreatedResponse({ type: MessagePartDto })
  async addMessagePart(
    @Param('id') _id: string,
    @Body() body: MessagePartInput,
  ): Promise<MessagePartInput> {
    return body;
  }

  @Post(':id/value')
  @ApiCreatedResponse({ type: StringOrNumberDto })
  async addValue(
    @Param('id') _id: string,
    @Body() body: StringOrNumberInput,
  ): Promise<StringOrNumberInput> {
    return body;
  }
}

@Controller('events')
export class EventController {
  @Get(':id')
  @ApiOkResponse({ type: EventDto })
  async getEvent(@Param('id') _id: string): Promise<EventDto> {
    return EventDto.create({
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Test Event',
      occurredAt: new Date(),
      deletedAt: null,
    });
  }
}

@Controller('search')
export class SearchController {
  @Get()
  @ApiOkResponse({ type: String, isArray: true })
  async search(@Query() _query: SearchQueryDto): Promise<string[]> {
    return [];
  }
}

@Controller('metadata')
export class MetadataController {
  @Get()
  @ApiOkResponse({ type: MetadataDto })
  async getMetadata(): Promise<MetadataDto> {
    return MetadataDto.create({ key: 'test' });
  }
}

@Controller('tagmap')
export class TagMapController {
  @Get()
  @ApiOkResponse({ type: TagMapDto })
  async getTagMap(): Promise<TagMapDto> {
    return TagMapDto.create({ labels: { a: 1 } });
  }
}

@Controller('nested')
export class NestedController {
  @Get()
  @ApiOkResponse({ type: NestedInlineDto })
  async getNested(): Promise<NestedInlineDto> {
    return NestedInlineDto.create({
      nested: { value: new Date() },
      items: [{ id: '550e8400-e29b-41d4-a716-446655440000', score: 1 }],
    });
  }
}

@Controller('container')
export class ContainerController {
  @Get()
  @ApiOkResponse({ type: ContainerDto })
  async getContainer(): Promise<ContainerDto> {
    return ContainerDto.create({
      part: { kind: 'a', val: 'hello' },
      tags: [{ kind: 'a', val: 'tag' }],
    });
  }
}

@Controller('passthrough-field')
export class PassthroughFieldController {
  @Get()
  @ApiOkResponse({ type: WithPassthroughFieldDto })
  async get(): Promise<WithPassthroughFieldDto> {
    return WithPassthroughFieldDto.create({ data: { x: 'test' } });
  }
}

@Controller('record-field')
export class RecordFieldController {
  @Get()
  @ApiOkResponse({ type: WithRecordFieldDto })
  async get(): Promise<WithRecordFieldDto> {
    return WithRecordFieldDto.create({ counts: { a: 1 } });
  }
}

@Controller('wrapped')
export class WrappedController {
  @Get()
  @ApiOkResponse({ type: WrappedDto })
  async get(): Promise<WrappedDto> {
    return WrappedDto.create({ opt: 'x', cat: null, ro: 'y' });
  }
}

@Controller('array-formats')
export class ArrayFormatsController {
  @Get()
  @ApiOkResponse({ type: ArrayFormatsDto })
  async get(): Promise<ArrayFormatsDto> {
    return ArrayFormatsDto.create({ uuids: [], dates: [] });
  }
}

@Controller('record-top')
export class RecordTopController {
  @Get()
  @ApiOkResponse({ type: RecordTopDto })
  async get(): Promise<any> {
    return { a: 1 };
  }
}

@Controller('default-date')
export class DefaultDateController {
  @Get()
  @ApiOkResponse({ type: DefaultDateDto })
  async get(): Promise<DefaultDateDto> {
    return DefaultDateDto.create({ createdAt: new Date(), updatedAt: new Date() });
  }
}

@Controller('inline-pass')
export class InlinePassController {
  @Get()
  @ApiOkResponse({ type: InlinePassDto })
  async get(): Promise<InlinePassDto> {
    return InlinePassDto.create({ part: 'hello' });
  }
}

@Controller('catchall-any')
export class CatchallAnyController {
  @Get()
  @ApiOkResponse({ type: CatchallAnyDto })
  async get(): Promise<CatchallAnyDto> {
    return CatchallAnyDto.create({ key: 'test' });
  }
}
