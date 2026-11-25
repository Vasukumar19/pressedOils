import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common'
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import {
  type ProductAvailabilityQuery,
  productAvailabilityQuerySchema,
  type ProductListQuery,
  productListQuerySchema,
  type PublicAvailabilityResponseDto,
  type PublicProductDto,
  type PublicProductListResponseDto,
  SIZE_LABELS,
  slugSchema,
} from '@pressedoils/shared'
import type { Request, Response } from 'express'
import { sendWithHttpCache } from '../common/http-cache'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { ProductsService } from './products.service'

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'List active products with filters, sorting, and pagination' })
  @ApiQuery({ name: 'inStockOnly', required: false, type: Boolean })
  @ApiQuery({ name: 'size', required: false, enum: SIZE_LABELS })
  @ApiQuery({ name: 'minPricePaise', required: false, type: Number })
  @ApiQuery({ name: 'maxPricePaise', required: false, type: Number })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['featured', 'price_asc', 'price_desc', 'newest'],
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Paginated active product catalog' })
  @ApiResponse({ status: 400, description: 'Invalid or unknown query parameters' })
  async list(
    @Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicProductListResponseDto | void> {
    const data = await this.productsService.list(query)
    return sendWithHttpCache(req, res, data, 'public, max-age=5, stale-while-revalidate=15')
  }

  @Get('availability')
  @ApiOperation({ summary: 'Fetch live variant availability (no HTTP caching)' })
  @ApiQuery({ name: 'variantIds', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Variant availability and max order qty cap' })
  async availability(
    @Query(new ZodValidationPipe(productAvailabilityQuerySchema)) query: ProductAvailabilityQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicAvailabilityResponseDto> {
    res.setHeader('Cache-Control', 'no-store')
    return this.productsService.getAvailability(query.variantIds)
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get active product detail by slug' })
  @ApiParam({ name: 'slug', type: String, example: 'groundnut-oil' })
  @ApiResponse({ status: 200, description: 'Product detail with variants and current batch' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async getBySlug(
    @Param('slug', new ZodValidationPipe(slugSchema)) slug: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicProductDto | void> {
    const data = await this.productsService.getBySlug(slug)
    return sendWithHttpCache(req, res, data, 'public, max-age=5, stale-while-revalidate=15')
  }
}
