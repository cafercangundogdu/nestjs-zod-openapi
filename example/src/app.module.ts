import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from '../../src';
import {
  AppController,
  ArrayFormatsController,
  CatchallAnyController,
  ContainerController,
  DefaultDateController,
  EventController,
  InlinePassController,
  MetadataController,
  NestedController,
  PassthroughFieldController,
  RecordFieldController,
  RecordTopController,
  SearchController,
  TagMapController,
  WrappedController,
} from './app.controller';

@Module({
  controllers: [
    AppController,
    EventController,
    SearchController,
    MetadataController,
    TagMapController,
    NestedController,
    ContainerController,
    PassthroughFieldController,
    RecordFieldController,
    WrappedController,
    ArrayFormatsController,
    RecordTopController,
    DefaultDateController,
    InlinePassController,
    CatchallAnyController,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
  ],
})
export class AppModule {}
