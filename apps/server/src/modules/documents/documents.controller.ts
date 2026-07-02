import { Controller, Get, Post, Delete, Param, Body, UseGuards, Request, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

const storage = diskStorage({
  destination: './uploads/documents',
  filename: (req, file, cb) => {
    const filename = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, filename);
  },
});

@Controller('documents')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get('me')
  async getMyDocuments(@Request() req: any) {
    if (!req.user.employeeId) return [];
    return this.documentsService.getMyDocuments(req.user.tenantId, req.user.employeeId);
  }

  @Get('all')
  @Roles('ADMIN', 'MANAGER')
  async getAllDocuments(@Request() req: any) {
    return this.documentsService.getAllDocuments(req.user.tenantId);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage }))
  async uploadDocument(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { title: string; type: string; expiryDate?: string }
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    
    if (!req.user.employeeId) {
      throw new BadRequestException('User is not linked to an employee record');
    }

    const fileUrl = `/uploads/documents/${file.filename}`;
    
    return this.documentsService.createDocument({
      tenantId: req.user.tenantId,
      employeeId: req.user.employeeId,
      title: body.title,
      type: body.type || 'OTHER',
      fileUrl,
      expiryDate: body.expiryDate ? new Date(body.expiryDate) : undefined,
    });
  }

  @Delete(':id')
  async deleteDocument(@Param('id') id: string, @Request() req: any) {
    // Ideally we should check if the document belongs to the user or if they are admin
    return this.documentsService.deleteDocument(id, req.user.tenantId);
  }
}
