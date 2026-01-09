export const getFileCategory = (fileName: string): 'sequence' | 'alignment' | 'variant' | 'document' | 'other' => {
  const ext = fileName.toLowerCase().split('.').pop() || ''
  
  if (['fastq', 'fq', 'gz', 'fa', 'fasta'].includes(ext)) return 'sequence'
  if (['bam', 'sam', 'bai', 'cram'].includes(ext)) return 'alignment'
  if (['vcf', 'bcf', 'bed', 'gff'].includes(ext)) return 'variant'
  if (['pdf', 'doc', 'docx', 'txt', 'xls', 'xlsx'].includes(ext)) return 'document'
  return 'other'
}

export const getFileIconColor = (category: ReturnType<typeof getFileCategory>): string => {
  const colorMap = {
    sequence: 'text-emerald-500',
    alignment: 'text-blue-500',
    variant: 'text-purple-500',
    document: 'text-orange-500',
    other: 'text-slate-400'
  }
  return colorMap[category]
}
