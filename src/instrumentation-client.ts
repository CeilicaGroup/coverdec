/**
 * React 19 + Turbopack (dev) can call performance.measure() with a negative `end`
 * when a Server Component aborts early (e.g. notFound()). Skip invalid measures.
 * @see https://github.com/vercel/next.js/issues/86060
 */
function guardInvalidPerformanceMeasure(): void {
  if (typeof performance === "undefined") return;
  const native = performance.measure.bind(performance);

  performance.measure = function patchedMeasure(
    name: string,
    startOrMeasureOptions?: string | PerformanceMeasureOptions,
    endMark?: string,
  ): PerformanceMeasure {
    if (
      startOrMeasureOptions &&
      typeof startOrMeasureOptions === "object" &&
      "end" in startOrMeasureOptions
    ) {
      const { start, end } = startOrMeasureOptions;
      if (typeof end === "number" && end < 0) {
        return {} as PerformanceMeasure;
      }
      if (
        typeof start === "number" &&
        typeof end === "number" &&
        end < start
      ) {
        return {} as PerformanceMeasure;
      }
    }

    return native(name, startOrMeasureOptions, endMark);
  };
}

if (process.env.NODE_ENV === "development") {
  guardInvalidPerformanceMeasure();
}
