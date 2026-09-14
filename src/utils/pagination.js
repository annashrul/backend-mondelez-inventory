export function paginationParams(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const requestedLimit = Number.parseInt(query.limit, 10) || 10;
  const limit = Math.min(100, Math.max(1, requestedLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export function paginated(items, query = {}) {
  const { page, limit } = paginationParams(query);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(page, totalPages);
  const currentOffset = (currentPage - 1) * limit;

  return {
    data: items.slice(currentOffset, currentOffset + limit),
    pagination: {
      page: currentPage,
      limit,
      total,
      total_pages: totalPages,
      has_next: currentPage < totalPages,
      has_prev: currentPage > 1,
    },
  };
}
