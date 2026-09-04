import { Global, Module } from '@nestjs/common';
import { OcrService } from './ocr.service';

// global: the upload paths that need it live in users, properties and
// projects, and none of them should have to import an OCR module to save a
// file — the same call StorageModule made.
@Global()
@Module({
  providers: [OcrService],
  exports: [OcrService],
})
export class OcrModule {}
