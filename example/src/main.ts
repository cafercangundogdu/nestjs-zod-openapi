import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';
import { initZodOpenApi, patchNestSwagger } from '../../src';

initZodOpenApi(z);

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('Example API')
    .setDescription('Demonstrates @cafercangundogdu/nestjs-zod-openapi')
    .setVersion('1.0')
    .build();

  patchNestSwagger({ schemasSort: 'alpha' });

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(3000);
}
bootstrap();
