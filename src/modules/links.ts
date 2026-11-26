import { AnnotationData, AttachmentData } from "./types";

export function annotationUrl(
  attachment: AttachmentData,
  annotation: AnnotationData,
): string {
  const page = annotation.pageIndex >= 0 ? annotation.pageIndex + 1 : 1;
  return `${attachment.uri}?page=${page}&annotation=${annotation.key}`;
}
