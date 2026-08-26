class AdminSummary {
  const AdminSummary({
    required this.products,
    required this.services,
    required this.outlets,
    required this.orders,
    required this.appointments,
    required this.jobs,
    required this.lowStockItems,
  });

  final int products;
  final int services;
  final int outlets;
  final int orders;
  final int appointments;
  final int jobs;
  final int lowStockItems;

  factory AdminSummary.fromJson(Map<String, dynamic> json) {
    return AdminSummary(
      products: (json['products'] as num?)?.toInt() ?? 0,
      services: (json['services'] as num?)?.toInt() ?? 0,
      outlets: (json['outlets'] as num?)?.toInt() ?? 0,
      orders: (json['orders'] as num?)?.toInt() ?? 0,
      appointments: (json['appointments'] as num?)?.toInt() ?? 0,
      jobs: (json['jobs'] as num?)?.toInt() ?? 0,
      lowStockItems: (json['low_stock_items'] as num?)?.toInt() ?? 0,
    );
  }
}

class AdminInventoryItem {
  const AdminInventoryItem({
    required this.id,
    required this.warehouseId,
    required this.productId,
    required this.variantId,
    required this.productName,
    required this.quantityOnHand,
    required this.quantityReserved,
    required this.availableQuantity,
    required this.status,
    required this.isActive,
  });

  final String id;
  final String warehouseId;
  final String productId;
  final String variantId;
  final String productName;
  final int quantityOnHand;
  final int quantityReserved;
  final int availableQuantity;
  final String status;
  final bool isActive;

  factory AdminInventoryItem.fromJson(Map<String, dynamic> json) {
    return AdminInventoryItem(
      id: json['id']?.toString() ?? '',
      warehouseId: json['warehouse_id']?.toString() ?? '',
      productId: json['product_id']?.toString() ?? '',
      variantId: json['variant_id']?.toString() ?? '',
      productName: json['product_name']?.toString() ?? '',
      quantityOnHand: (json['quantity_on_hand'] as num?)?.toInt() ?? 0,
      quantityReserved: (json['quantity_reserved'] as num?)?.toInt() ?? 0,
      availableQuantity: (json['available_quantity'] as num?)?.toInt() ?? 0,
      status: json['status']?.toString() ?? 'ACTIVE',
      isActive: json['is_active'] == true,
    );
  }
}

class AdminBulkImportResult {
  const AdminBulkImportResult({
    required this.total,
    required this.created,
    required this.updated,
    required this.failed,
    required this.ids,
    required this.errors,
  });

  final int total;
  final int created;
  final int updated;
  final int failed;
  final List<String> ids;
  final List<AdminBulkImportError> errors;

  factory AdminBulkImportResult.fromJson(Map<String, dynamic> json) {
    final rawIds = json['ids'];
    final rawErrors = json['errors'];
    return AdminBulkImportResult(
      total: (json['total'] as num?)?.toInt() ?? 0,
      created: (json['created'] as num?)?.toInt() ?? 0,
      updated: (json['updated'] as num?)?.toInt() ?? 0,
      failed: (json['failed'] as num?)?.toInt() ?? 0,
      ids: rawIds is List
          ? rawIds.map((id) => id.toString()).toList()
          : const [],
      errors: rawErrors is List
          ? rawErrors
                .whereType<Map<String, dynamic>>()
                .map(AdminBulkImportError.fromJson)
                .toList()
          : const [],
    );
  }

  String get summary {
    return 'Total $total / Created $created / Updated $updated / Failed $failed';
  }
}

class AdminBulkImportError {
  const AdminBulkImportError({required this.row, required this.error});

  final int row;
  final String error;

  factory AdminBulkImportError.fromJson(Map<String, dynamic> json) {
    return AdminBulkImportError(
      row: (json['row'] as num?)?.toInt() ?? 0,
      error: json['error']?.toString() ?? '',
    );
  }
}

class AdminSchemaCheckRecord {
  const AdminSchemaCheckRecord({
    required this.table,
    required this.ok,
    required this.status,
    required this.columns,
    required this.presentColumns,
    required this.missingColumns,
    required this.missingHint,
  });

  final String table;
  final bool ok;
  final String status;
  final List<String> columns;
  final List<String> presentColumns;
  final List<String> missingColumns;
  final String missingHint;

  factory AdminSchemaCheckRecord.fromJson(Map<String, dynamic> json) {
    final rawColumns = json['columns'];
    final rawPresentColumns = json['present_columns'];
    final rawMissingColumns = json['missing_columns'];
    return AdminSchemaCheckRecord(
      table: json['table']?.toString() ?? '',
      ok: json['ok'] == true,
      status: json['status']?.toString() ?? '',
      columns: rawColumns is List
          ? rawColumns.map((item) => item.toString()).toList()
          : const [],
      presentColumns: rawPresentColumns is List
          ? rawPresentColumns.map((item) => item.toString()).toList()
          : const [],
      missingColumns: rawMissingColumns is List
          ? rawMissingColumns.map((item) => item.toString()).toList()
          : const [],
      missingHint: json['missing_hint']?.toString() ?? '',
    );
  }
}

class AdminUploadedFile {
  const AdminUploadedFile({
    required this.assetId,
    required this.fileId,
    required this.folderId,
    required this.fileName,
    required this.fileUrl,
    required this.contentType,
    required this.fileSize,
  });

  final String assetId;
  final String fileId;
  final String folderId;
  final String fileName;
  final String fileUrl;
  final String contentType;
  final int fileSize;

  factory AdminUploadedFile.fromJson(Map<String, dynamic> json) {
    return AdminUploadedFile(
      assetId: json['asset_id']?.toString() ?? '',
      fileId: json['file_id']?.toString() ?? '',
      folderId: json['folder_id']?.toString() ?? '',
      fileName: json['file_name']?.toString() ?? '',
      fileUrl: json['file_url']?.toString() ?? '',
      contentType: json['content_type']?.toString() ?? '',
      fileSize: (json['file_size'] as num?)?.toInt() ?? 0,
    );
  }
}

class AdminMediaAsset {
  const AdminMediaAsset({
    required this.id,
    required this.mediaType,
    required this.fileId,
    required this.folderId,
    required this.fileName,
    required this.fileUrl,
    required this.contentType,
    required this.fileSize,
    required this.mappedEntityType,
    required this.mappedEntityId,
    required this.mappedField,
  });

  final String id;
  final String mediaType;
  final String fileId;
  final String folderId;
  final String fileName;
  final String fileUrl;
  final String contentType;
  final int fileSize;
  final String mappedEntityType;
  final String mappedEntityId;
  final String mappedField;

  factory AdminMediaAsset.fromJson(Map<String, dynamic> json) {
    return AdminMediaAsset(
      id: json['id']?.toString() ?? '',
      mediaType: json['media_type']?.toString() ?? '',
      fileId: json['file_id']?.toString() ?? '',
      folderId: json['folder_id']?.toString() ?? '',
      fileName: json['file_name']?.toString() ?? '',
      fileUrl: json['file_url']?.toString() ?? '',
      contentType: json['content_type']?.toString() ?? '',
      fileSize: (json['file_size'] as num?)?.toInt() ?? 0,
      mappedEntityType: json['mapped_entity_type']?.toString() ?? '',
      mappedEntityId: json['mapped_entity_id']?.toString() ?? '',
      mappedField: json['mapped_field']?.toString() ?? '',
    );
  }

  bool get isMapped => mappedEntityId.isNotEmpty;

  String get mappedLabel {
    if (!isMapped) {
      return 'Not mapped';
    }
    return '$mappedEntityType $mappedEntityId -> $mappedField';
  }
}

class AdminMediaTarget {
  const AdminMediaTarget({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.imageUrl,
    required this.status,
  });

  final String id;
  final String title;
  final String subtitle;
  final String imageUrl;
  final String status;

  factory AdminMediaTarget.fromJson(Map<String, dynamic> json) {
    return AdminMediaTarget(
      id: json['id']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      subtitle: json['subtitle']?.toString() ?? '',
      imageUrl: json['image_url']?.toString() ?? '',
      status: json['status']?.toString() ?? '',
    );
  }
}

class AdminProductRecord {
  const AdminProductRecord({
    required this.id,
    required this.name,
    required this.slug,
    required this.sku,
    required this.brandId,
    required this.categoryId,
    required this.shortDescription,
    required this.description,
    required this.mrp,
    required this.sellingPrice,
    required this.currency,
    required this.taxPercent,
    required this.thumbnailUrl,
    required this.hasVariants,
    required this.isFeatured,
    required this.status,
  });

  final String id;
  final String name;
  final String slug;
  final String sku;
  final String brandId;
  final String categoryId;
  final String shortDescription;
  final String description;
  final double mrp;
  final double sellingPrice;
  final String currency;
  final double taxPercent;
  final String thumbnailUrl;
  final bool hasVariants;
  final bool isFeatured;
  final String status;

  factory AdminProductRecord.fromJson(Map<String, dynamic> json) {
    return AdminProductRecord(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      slug: json['slug']?.toString() ?? '',
      sku: json['sku']?.toString() ?? '',
      brandId: json['brand_id']?.toString() ?? '',
      categoryId: json['category_id']?.toString() ?? '',
      shortDescription: json['short_description']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      mrp: (json['mrp'] as num?)?.toDouble() ?? 0,
      sellingPrice: (json['selling_price'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
      taxPercent: (json['tax_percent'] as num?)?.toDouble() ?? 0,
      thumbnailUrl: json['thumbnail_url']?.toString() ?? '',
      hasVariants: json['has_variants'] == true,
      isFeatured: json['is_featured'] == true,
      status: json['status']?.toString() ?? 'ACTIVE',
    );
  }

  bool get isActive => status.toUpperCase() == 'ACTIVE';
}

class AdminServiceRecord {
  const AdminServiceRecord({
    required this.id,
    required this.name,
    required this.slug,
    required this.description,
    required this.categoryId,
    required this.imageUrl,
    required this.durationMinutes,
    required this.gender,
    required this.mrp,
    required this.sellingPrice,
    required this.currency,
    required this.status,
    required this.isActive,
  });

  final String id;
  final String name;
  final String slug;
  final String description;
  final String categoryId;
  final String imageUrl;
  final int durationMinutes;
  final String gender;
  final double mrp;
  final double sellingPrice;
  final String currency;
  final String status;
  final bool isActive;

  factory AdminServiceRecord.fromJson(Map<String, dynamic> json) {
    return AdminServiceRecord(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      slug: json['slug']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      categoryId: json['category_id']?.toString() ?? '',
      imageUrl: json['image_url']?.toString() ?? '',
      durationMinutes: (json['duration_minutes'] as num?)?.toInt() ?? 0,
      gender: json['gender']?.toString() ?? 'UNISEX',
      mrp: (json['mrp'] as num?)?.toDouble() ?? 0,
      sellingPrice: (json['selling_price'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
      status: json['status']?.toString() ?? 'ACTIVE',
      isActive: json['is_active'] == true,
    );
  }
}

class AdminOutletRecord {
  const AdminOutletRecord({
    required this.id,
    required this.name,
    required this.slug,
    required this.code,
    required this.salonCategory,
    required this.addressLine1,
    required this.city,
    required this.state,
    required this.postalCode,
    required this.phone,
    required this.latitude,
    required this.longitude,
    required this.openingTime,
    required this.closingTime,
    required this.imageUrl,
    required this.videoUrl,
    required this.isActive,
  });

  final String id;
  final String name;
  final String slug;
  final String code;
  final String salonCategory;
  final String addressLine1;
  final String city;
  final String state;
  final String postalCode;
  final String phone;
  final String latitude;
  final String longitude;
  final String openingTime;
  final String closingTime;
  final String imageUrl;
  final String videoUrl;
  final bool isActive;

  factory AdminOutletRecord.fromJson(Map<String, dynamic> json) {
    return AdminOutletRecord(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      slug: json['slug']?.toString() ?? '',
      code: json['code']?.toString() ?? '',
      salonCategory: json['salon_category']?.toString() ?? 'Gold',
      addressLine1: json['address_line1']?.toString() ?? '',
      city: json['city']?.toString() ?? '',
      state: json['state']?.toString() ?? '',
      postalCode: json['postal_code']?.toString() ?? '',
      phone: json['phone']?.toString() ?? '',
      latitude: json['latitude']?.toString() ?? '',
      longitude: json['longitude']?.toString() ?? '',
      openingTime: json['opening_time']?.toString() ?? '',
      closingTime: json['closing_time']?.toString() ?? '',
      imageUrl: json['image_url']?.toString() ?? '',
      videoUrl: json['video_url']?.toString() ?? '',
      isActive: json['is_active'] == true,
    );
  }
}

class AdminOrderRecord {
  const AdminOrderRecord({
    required this.id,
    required this.userId,
    required this.orderNumber,
    required this.status,
    required this.paymentStatus,
    required this.currency,
    required this.grandTotal,
    required this.shippingName,
    required this.shippingCity,
  });

  final String id;
  final String userId;
  final String orderNumber;
  final String status;
  final String paymentStatus;
  final String currency;
  final double grandTotal;
  final String shippingName;
  final String shippingCity;

  factory AdminOrderRecord.fromJson(Map<String, dynamic> json) {
    return AdminOrderRecord(
      id: json['id']?.toString() ?? '',
      userId: json['user_id']?.toString() ?? '',
      orderNumber: json['order_number']?.toString() ?? '',
      status: json['status']?.toString() ?? 'PLACED',
      paymentStatus: json['payment_status']?.toString() ?? 'PENDING',
      currency: json['currency']?.toString() ?? 'INR',
      grandTotal: (json['grand_total'] as num?)?.toDouble() ?? 0,
      shippingName: json['shipping_name']?.toString() ?? '',
      shippingCity: json['shipping_city']?.toString() ?? '',
    );
  }
}

class AdminBookingRecord {
  const AdminBookingRecord({
    required this.id,
    required this.userId,
    required this.outletId,
    required this.staffId,
    required this.slotId,
    required this.appointmentNumber,
    required this.appointmentDate,
    required this.startTime,
    required this.endTime,
    required this.status,
    required this.paymentStatus,
    required this.currency,
    required this.grandTotal,
  });

  final String id;
  final String userId;
  final String outletId;
  final String staffId;
  final String slotId;
  final String appointmentNumber;
  final String appointmentDate;
  final String startTime;
  final String endTime;
  final String status;
  final String paymentStatus;
  final String currency;
  final double grandTotal;

  factory AdminBookingRecord.fromJson(Map<String, dynamic> json) {
    return AdminBookingRecord(
      id: json['id']?.toString() ?? '',
      userId: json['user_id']?.toString() ?? '',
      outletId: json['outlet_id']?.toString() ?? '',
      staffId: json['staff_id']?.toString() ?? '',
      slotId: json['slot_id']?.toString() ?? '',
      appointmentNumber: json['appointment_number']?.toString() ?? '',
      appointmentDate: json['appointment_date']?.toString() ?? '',
      startTime: json['start_time']?.toString() ?? '',
      endTime: json['end_time']?.toString() ?? '',
      status: json['status']?.toString() ?? 'CONFIRMED',
      paymentStatus: json['payment_status']?.toString() ?? 'PENDING',
      currency: json['currency']?.toString() ?? 'INR',
      grandTotal: (json['grand_total'] as num?)?.toDouble() ?? 0,
    );
  }
}

class AdminStockMovementRecord {
  const AdminStockMovementRecord({
    required this.id,
    required this.inventoryId,
    required this.warehouseId,
    required this.productId,
    required this.variantId,
    required this.movementType,
    required this.quantity,
    required this.referenceType,
    required this.referenceId,
    required this.notes,
  });

  final String id;
  final String inventoryId;
  final String warehouseId;
  final String productId;
  final String variantId;
  final String movementType;
  final int quantity;
  final String referenceType;
  final String referenceId;
  final String notes;

  factory AdminStockMovementRecord.fromJson(Map<String, dynamic> json) {
    return AdminStockMovementRecord(
      id: json['id']?.toString() ?? '',
      inventoryId: json['inventory_id']?.toString() ?? '',
      warehouseId: json['warehouse_id']?.toString() ?? '',
      productId: json['product_id']?.toString() ?? '',
      variantId: json['variant_id']?.toString() ?? '',
      movementType: json['movement_type']?.toString() ?? '',
      quantity: (json['quantity'] as num?)?.toInt() ?? 0,
      referenceType: json['reference_type']?.toString() ?? '',
      referenceId: json['reference_id']?.toString() ?? '',
      notes: json['notes']?.toString() ?? '',
    );
  }
}

class AdminAuditLogRecord {
  const AdminAuditLogRecord({
    required this.id,
    required this.actorType,
    required this.action,
    required this.entityType,
    required this.entityId,
    required this.beforeJson,
    required this.afterJson,
    required this.ipAddress,
    required this.createdTime,
  });

  final String id;
  final String actorType;
  final String action;
  final String entityType;
  final String entityId;
  final String beforeJson;
  final String afterJson;
  final String ipAddress;
  final String createdTime;

  factory AdminAuditLogRecord.fromJson(Map<String, dynamic> json) {
    return AdminAuditLogRecord(
      id: json['id']?.toString() ?? '',
      actorType: json['actor_type']?.toString() ?? '',
      action: json['action']?.toString() ?? '',
      entityType: json['entity_type']?.toString() ?? '',
      entityId: json['entity_id']?.toString() ?? '',
      beforeJson: json['before_json']?.toString() ?? '',
      afterJson: json['after_json']?.toString() ?? '',
      ipAddress: json['ip_address']?.toString() ?? '',
      createdTime: json['created_time']?.toString() ?? '',
    );
  }
}

class AdminServiceJobRecord {
  const AdminServiceJobRecord({
    required this.id,
    required this.userId,
    required this.appointmentId,
    required this.providerId,
    required this.status,
    required this.visitAddressId,
    required this.visitLine1,
    required this.visitCity,
    required this.visitState,
    required this.scheduledAt,
    required this.requestedAt,
    required this.grandTotal,
    required this.currency,
  });

  final String id;
  final String userId;
  final String appointmentId;
  final String providerId;
  final String status;
  final String visitAddressId;
  final String visitLine1;
  final String visitCity;
  final String visitState;
  final String scheduledAt;
  final String requestedAt;
  final double grandTotal;
  final String currency;

  String get amountLabel {
    final price = grandTotal.toStringAsFixed(0);
    return currency == 'INR' ? 'INR $price' : '$currency $price';
  }

  factory AdminServiceJobRecord.fromJson(Map<String, dynamic> json) {
    return AdminServiceJobRecord(
      id: json['id']?.toString() ?? '',
      userId: json['user_id']?.toString() ?? '',
      appointmentId: json['appointment_id']?.toString() ?? '',
      providerId: json['provider_id']?.toString() ?? '',
      status: json['status']?.toString() ?? 'REQUESTED',
      visitAddressId: json['visit_address_id']?.toString() ?? '',
      visitLine1: json['visit_line1']?.toString() ?? '',
      visitCity: json['visit_city']?.toString() ?? '',
      visitState: json['visit_state']?.toString() ?? '',
      scheduledAt: json['scheduled_at']?.toString() ?? '',
      requestedAt: json['requested_at']?.toString() ?? '',
      grandTotal: (json['grand_total'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
    );
  }
}

class AdminProviderRecord {
  const AdminProviderRecord({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.phone,
    required this.rating,
    required this.status,
    required this.isActive,
  });

  final String id;
  final String firstName;
  final String lastName;
  final String phone;
  final double rating;
  final String status;
  final bool isActive;

  String get fullName =>
      [firstName, lastName].where((s) => s.isNotEmpty).join(' ');

  factory AdminProviderRecord.fromJson(Map<String, dynamic> json) {
    return AdminProviderRecord(
      id: json['id']?.toString() ?? '',
      firstName: json['first_name']?.toString() ?? '',
      lastName: json['last_name']?.toString() ?? '',
      phone: json['phone']?.toString() ?? '',
      rating: (json['rating'] as num?)?.toDouble() ?? 0,
      status: json['status']?.toString() ?? 'AVAILABLE',
      isActive:
          json['is_active'] == true || json['is_active']?.toString() == 'true',
    );
  }
}
