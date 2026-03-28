/**
 * data.js — Credential schemas, types, sample data, and UI metadata
 */

const CredentialTypes = {
  IDENTITY: {
    key: 'IdentityCredential',
    label: 'Identity Card',
    icon: '🪪',
    color: '#6366f1',
    gradient: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
    fields: [
      { key: 'name', label: 'Full Name', type: 'text', required: true, sensitive: false },
      { key: 'enrollmentId', label: 'Enrollment ID', type: 'text', required: true, sensitive: false },
      { key: 'dateOfBirth', label: 'Date of Birth', type: 'date', required: true, sensitive: true },
      { key: 'program', label: 'Program', type: 'text', required: true, sensitive: false },
      { key: 'department', label: 'Department', type: 'text', required: true, sensitive: false },
      { key: 'enrollmentStatus', label: 'Enrollment Status', type: 'select', options: ['Active', 'Alumni', 'On Leave', 'Graduated'], required: true, sensitive: false },
      { key: 'enrollmentYear', label: 'Enrollment Year', type: 'number', required: true, sensitive: false },
    ],
  },
  TRANSCRIPT: {
    key: 'AcademicTranscript',
    label: 'Academic Transcript',
    icon: '📜',
    color: '#059669',
    gradient: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
    fields: [
      { key: 'name', label: 'Full Name', type: 'text', required: true, sensitive: false },
      { key: 'enrollmentId', label: 'Enrollment ID', type: 'text', required: true, sensitive: false },
      { key: 'program', label: 'Program', type: 'text', required: true, sensitive: false },
      { key: 'gpa', label: 'GPA (out of 10)', type: 'number', required: true, sensitive: true, zkpEligible: true },
      { key: 'totalCredits', label: 'Total Credits', type: 'number', required: true, sensitive: false },
      { key: 'semester', label: 'Current Semester', type: 'number', required: true, sensitive: false },
      { key: 'courses', label: 'Courses (comma-separated)', type: 'textarea', required: false, sensitive: false },
    ],
  },
  ACHIEVEMENT: {
    key: 'AchievementCredential',
    label: 'Achievement Card',
    icon: '🏆',
    color: '#d97706',
    gradient: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
    fields: [
      { key: 'name', label: 'Full Name', type: 'text', required: true, sensitive: false },
      { key: 'enrollmentId', label: 'Enrollment ID', type: 'text', required: true, sensitive: false },
      { key: 'achievementType', label: 'Type', type: 'select', options: ['Club Board Position', 'Hackathon', 'Research Publication', 'Sports Achievement', 'Community Service'], required: true, sensitive: false },
      { key: 'title', label: 'Title / Position', type: 'text', required: true, sensitive: false },
      { key: 'organization', label: 'Organization / Event', type: 'text', required: true, sensitive: false },
      { key: 'dateAwarded', label: 'Date Awarded', type: 'date', required: true, sensitive: false },
      { key: 'description', label: 'Description', type: 'textarea', required: false, sensitive: false },
    ],
  },
  FINANCIAL: {
    key: 'FinancialAidCredential',
    label: 'Financial / Grant Card',
    icon: '💰',
    color: '#dc2626',
    gradient: 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)',
    fields: [
      { key: 'name', label: 'Full Name', type: 'text', required: true, sensitive: false },
      { key: 'enrollmentId', label: 'Enrollment ID', type: 'text', required: true, sensitive: false },
      { key: 'scholarshipName', label: 'Scholarship / Grant Name', type: 'text', required: true, sensitive: false },
      { key: 'amount', label: 'Amount (₹)', type: 'number', required: true, sensitive: true },
      { key: 'academicYear', label: 'Academic Year', type: 'text', required: true, sensitive: false },
      { key: 'renewalStatus', label: 'Renewal Status', type: 'select', options: ['Active', 'Pending Renewal', 'Expired', 'Non-Renewable'], required: true, sensitive: false },
    ],
  },
};

// Default issuer for Shiv Nadar University
const DEFAULT_ISSUER = {
  id: 'did:web:shivnadar.university',
  name: 'Shiv Nadar University',
  shortName: 'SNU',
};

// Sample student data for quick demo fill
const SAMPLE_STUDENTS = [
  {
    name: 'Krit Lunkad',
    enrollmentId: 'SNU2024001',
    dateOfBirth: '2003-06-15',
    program: 'B.Tech Computer Science',
    department: 'Computer Science & Engineering',
    enrollmentStatus: 'Active',
    enrollmentYear: 2024,
    gpa: 8.7,
    totalCredits: 64,
    semester: 4,
    courses: 'Data Structures, Algorithms, DBMS, OS, Computer Networks',
    achievementType: 'Hackathon',
    title: '1st Place - TechFest 2025',
    organization: 'SNU Tech Club',
    dateAwarded: '2025-11-20',
    description: 'Won first place in 48-hour hackathon building a decentralized identity system',
    scholarshipName: 'Merit Scholarship',
    amount: 200000,
    academicYear: '2024-2025',
    renewalStatus: 'Active',
  },
  {
    name: 'Arjun Mehta',
    enrollmentId: 'SNU2024042',
    dateOfBirth: '2003-09-22',
    program: 'B.Tech AI & Data Science',
    department: 'Computer Science & Engineering',
    enrollmentStatus: 'Active',
    enrollmentYear: 2024,
    gpa: 9.1,
    totalCredits: 68,
    semester: 4,
    courses: 'Machine Learning, Deep Learning, NLP, Statistics, Linear Algebra',
  },
];

// Build a W3C VC-like credential object
function buildCredential(type, subjectData, issuer, expiryDays = 365) {
  const now = new Date();
  const expiry = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);

  return {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    id: CryptoModule.generateId(),
    type: ['VerifiableCredential', type.key],
    issuer: {
      id: issuer.id,
      name: issuer.name,
      ...(issuer.walletAddress ? { walletAddress: issuer.walletAddress } : {}),
    },
    issuanceDate: now.toISOString(),
    expirationDate: expiry.toISOString(),
    credentialSubject: {
      id: `did:student:${subjectData.enrollmentId}`,
      ...subjectData,
    },
    // proof is added after signing
  };
}

function getCredentialTypeInfo(typeKey) {
  return Object.values(CredentialTypes).find(t => t.key === typeKey);
}

function getExpiryStatus(expirationDate) {
  const now = new Date();
  const expiry = new Date(expirationDate);
  const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

  if (daysLeft < 0) return { status: 'expired', label: 'Expired', class: 'badge-expired', daysLeft };
  if (daysLeft < 30) return { status: 'expiring', label: `Expires in ${daysLeft}d`, class: 'badge-expiring', daysLeft };
  return { status: 'valid', label: 'Valid', class: 'badge-valid', daysLeft };
}
