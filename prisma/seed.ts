import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Grades data
const grades = [
  { name: 'VI', level: 'Junior' },
  { name: 'VII', level: 'Junior' },
  { name: 'VIII', level: 'Junior' },
  { name: 'IX', level: 'Senior' },
  { name: 'X', level: 'Senior' },
  { name: 'XI', level: 'Senior' },
  { name: 'XII', level: 'Senior' },
];

// Sections per grade
const sectionsPerGrade: Record<string, { name: string; stream?: string }[]> = {
  'VI': [
    { name: 'VIA' }, { name: 'VIB' }, { name: 'VIC' }, { name: 'VID' }, { name: 'VIE' },
  ],
  'VII': [
    { name: 'VIIA' }, { name: 'VIIB' }, { name: 'VIIC' }, { name: 'VIID' }, { name: 'VIIE' },
  ],
  'VIII': [
    { name: 'VIIIA' }, { name: 'VIIIB' }, { name: 'VIIIC' }, { name: 'VIIID' }, { name: 'VIIIE' }, { name: 'VIIIF' },
  ],
  'IX': [
    { name: 'IXA' }, { name: 'IXB' }, { name: 'IXC' }, { name: 'IXD' }, { name: 'IXE' }, { name: 'IXF' },
  ],
  'X': [
    { name: 'XA' }, { name: 'XB' }, { name: 'XC' }, { name: 'XD' }, { name: 'XE' },
  ],
  'XI': [
    { name: 'XIA', stream: 'Science' },
    { name: 'XIB', stream: 'Science' },
    { name: 'XIC', stream: 'Arts' },
    { name: 'XID', stream: 'Commerce' },
    { name: 'XIE', stream: 'Commerce' },
    { name: 'XIF', stream: 'Commerce' },
  ],
  'XII': [
    { name: 'XIIA', stream: 'Science' },
    { name: 'XIIB', stream: 'Science' },
    { name: 'XIIC', stream: 'Arts' },
    { name: 'XIID', stream: 'Commerce' },
    { name: 'XIIE', stream: 'Commerce' },
    { name: 'XIIF', stream: 'Commerce' },
  ],
};

// Subjects data
const subjects = [
  { name: 'English', code: 'Eng', category: 'Core', requiresLab: false },
  { name: 'Mathematics', code: 'Math', category: 'Core', requiresLab: false },
  { name: 'Science', code: 'Sci', category: 'Science', requiresLab: true },
  { name: 'Physics', code: 'Phy', category: 'Science', requiresLab: true, isDoublePeriod: true },
  { name: 'Chemistry', code: 'Chem', category: 'Science', requiresLab: true, isDoublePeriod: true },
  { name: 'Biology', code: 'Bio', category: 'Science', requiresLab: true, isDoublePeriod: true },
  { name: 'Social Studies', code: 'S.St', category: 'Core', requiresLab: false },
  { name: 'Geography', code: 'Geo', category: 'Elective', requiresLab: false },
  { name: 'History', code: 'Hist', category: 'Elective', requiresLab: false },
  { name: 'Hindi', code: 'Hin', category: 'Language', requiresLab: false },
  { name: 'Nepali', code: 'Nep', category: 'Language', requiresLab: false },
  { name: 'French', code: 'Fr', category: 'Language', requiresLab: false },
  { name: 'Computer Science', code: 'Comp', category: 'Elective', requiresLab: true },
  { name: 'Informatics Practices', code: 'IP', category: 'Elective', requiresLab: true },
  { name: 'Economics', code: 'Eco', category: 'Elective', requiresLab: false },
  { name: 'Accountancy', code: 'Acc', category: 'Commerce', requiresLab: false },
  { name: 'Business Studies', code: 'B.St', category: 'Commerce', requiresLab: false },
  { name: 'Home Science', code: 'H.Sc', category: 'Elective', requiresLab: true },
  { name: 'Library', code: 'Lib', category: 'Activity', requiresLab: false },
  { name: 'Games', code: 'Games', category: 'Activity', requiresLab: false },
  { name: 'Yoga', code: 'Yoga', category: 'Activity', requiresLab: false },
  { name: 'Aerobics', code: 'Aer', category: 'Activity', requiresLab: false },
  { name: 'Work Experience', code: 'WE', category: 'Activity', requiresLab: false },
  { name: 'Innovation', code: 'Inn', category: 'Activity', requiresLab: false },
  { name: 'Art', code: 'Art', category: 'Activity', requiresLab: false },
  { name: 'Music', code: 'Mus', category: 'Activity', requiresLab: false },
  { name: 'Dance', code: 'Dance', category: 'Activity', requiresLab: false },
];

// Teachable grades per teacher (derived from PDF assignments)
const teachableGrades: Record<string, string[]> = {
  // English
  'BL':  ['XI', 'XII'],
  'ABF': ['XII'],
  'SU':  ['IX', 'XI', 'XII'],
  'DS1': ['IX', 'X', 'XI'],
  'RLC': ['X', 'XI', 'XII'],
  'SB':  ['VIII', 'IX', 'X'],
  'RT':  ['VIII', 'IX', 'X'],
  'AS1': ['VIII', 'IX', 'X'],
  'RK':  ['VII', 'VIII'],
  'FBA': ['VI'],
  'RA':  ['VI'],
  'PSK': ['VI'],
  // Physics
  'SPK': ['XI', 'XII'],
  'BDB': ['X', 'XI', 'XII'],
  'BSD': ['VIII', 'IX', 'X'],
  'MKG': ['VIII', 'IX', 'X'],
  'RM':  ['VII', 'IX', 'X'],
  // Chemistry
  'SKH': ['X', 'XI', 'XII'],
  'PKR': ['X', 'XI', 'XII'],
  // Biology
  'KKS': ['IX', 'X', 'XII'],
  'EA':  ['VII', 'X', 'XI'],
  'NSS': ['VIII', 'IX', 'X'],
  'PKS': ['VIII', 'IX', 'X'],
  'RR':  ['VI', 'VII', 'IX'],
  'DD':  ['VI', 'VIII', 'X'],
  // Mathematics
  'AP':  ['VIII', 'IX', 'XII'],
  'AKJ': ['IX', 'X'],
  'NK':  ['X', 'XI', 'XII'],
  'DKM': ['VIII', 'X'],
  'RS1': ['VIII', 'IX', 'XII'],
  'DT':  ['IX', 'X', 'XI'],
  'KKK': ['VIII', 'IX', 'XI'],
  'SS':  ['VII', 'VIII'],
  'SR':  ['VI', 'VII'],
  'JS1': ['VII', 'VIII', 'IX'],
  'MR':  ['VI'],
  'KS':  ['VI', 'VII'],
  'MA':  ['VI'],
  // Hindi
  'US':  ['VI', 'VII', 'VIII', 'IX', 'X'],
  'NJ':  ['VI', 'VII', 'VIII', 'X'],
  'RS2': ['VI', 'VII', 'VIII', 'IX'],
  'GC':  ['VI', 'VII', 'VIII'],
  'PR':  ['VI', 'VII', 'VIII', 'X'],
  // Nepali
  'PM':  ['VI', 'VIII', 'IX', 'X'],
  'DS2': ['VII', 'VIII', 'IX', 'X'],
  'AS2': ['VI', 'VII', 'VIII', 'IX', 'X'],
  'KG':  ['VI', 'VII', 'VIII', 'IX', 'X'],
  'JBK': ['VI', 'VII', 'IX', 'X'],
  'AG':  ['VI', 'VII', 'VIII', 'IX'],
  'AS3': ['VI', 'VII', 'VIII'],
  // Commerce
  'RBJ': ['XI', 'XII'],
  'TC':  ['XII'],
  'PK':  ['XI', 'XII'],
  'PT':  ['XI'],
  // Economics
  'PS':  ['XI', 'XII'],
  'BP':  ['X', 'XI', 'XII'],
  'PP':  ['XI', 'XII'],
  // Social Studies
  'SSB': ['X', 'XII'],
  'DG':  ['VIII', 'XI'],
  'GK':  ['VII', 'IX', 'X'],
  'KC':  ['VIII', 'IX', 'X'],
  'KT':  ['VIII', 'IX', 'X'],
  'ARS': ['VI', 'VII', 'VIII'],
  'SJ':  ['VI', 'VII', 'VIII'],
  // Home Science
  'LK':  ['VII', 'X', 'XI', 'XII'],
  // Computer Science
  'PKT': ['XII'],
  'BK':  ['IX', 'XI'],
  'DRK': ['X', 'XI', 'XII'],
  'RK2': ['IX', 'X', 'XI'],
  'SN':  ['VII', 'VIII'],
  'PA':  ['VI', 'VII'],
  // French
  'JS2': ['VI', 'VII', 'VIII'],
  // Art (W.E.)
  'RMK': ['VI', 'VII'],
  'MSP': ['VIII', 'IX'],
  // Dance (W.E.)
  'BM':  ['VI', 'VII', 'VIII'],
  'KSM': ['VIII', 'IX'],
  // Music (W.E.) — SPR/NT cover VI-VII; HDP covers VIII-IX; BTK covers IX
  'SPR': ['VI', 'VII'],
  'NT':  ['VI', 'VII'],
  'HDP': ['VIII', 'IX'],
  'BTK': ['IX'],
  // Sports
  'DRA': ['VI', 'VII', 'VIII'],
  'NR':  ['VII', 'VIII'],
  'BKK': ['VIII', 'IX', 'X'],
  'PM2': ['X', 'XI'],
  'AB':  ['XI', 'XII'],
  // Yoga
  'ST':  ['VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'],
  // Library
  'PM3': ['VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'],
  'OPS': ['VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'],
  // Music (inactive for W.E. allocation — see Dance/Music teachable grades above)
  'SSM': ['XII'],
  'YM':  ['XII'],
  // Lab assistants
  'AT':  ['VI'],
  'DB':  ['VII'],
  'SKM': ['IX'],
  'RKM': ['IX'],
  'AM':  ['IX'],
  'UM':  ['VI', 'VII', 'VIII'],
  // Counselling
  'SSN': ['VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'],
};

// Teachers data from the PDFs
const teachers = [
  // ENGLISH
  { name: 'Ms. Bibha Lal', abbreviation: 'BL', department: 'English', isHOD: false, targetWorkload: 18 },
  { name: 'Ms. Anupa Bomjam Fitzpatrick', abbreviation: 'ABF', department: 'English', isHOD: true, targetWorkload: 18 },
  { name: 'Ms. Srijana Upadhaya', abbreviation: 'SU', department: 'English', isHOD: false, targetWorkload: 25 },
  { name: 'Ms. Deepa Silwal', abbreviation: 'DS1', department: 'English', isHOD: false, targetWorkload: 22 },
  { name: 'Ms. Reema Lepcha Chhetri', abbreviation: 'RLC', department: 'English', isHOD: false, targetWorkload: 24 },
  { name: 'Ms. Samira Ban', abbreviation: 'SB', department: 'English', isHOD: false, targetWorkload: 25 },
  { name: 'Mr. Rupesh Thapa', abbreviation: 'RT', department: 'English', isHOD: false, targetWorkload: 26 },
  { name: 'Ms. Anisha Subba', abbreviation: 'AS1', department: 'English', isHOD: false, targetWorkload: 26 },
  { name: 'Ms. Riya Kaushik', abbreviation: 'RK', department: 'English', isHOD: false, targetWorkload: 30 },
  { name: 'Ms. Farida Banu Ahmed', abbreviation: 'FBA', department: 'English', isHOD: false, targetWorkload: 12 },
  { name: 'Ms. Rohini Agrawal', abbreviation: 'RA', department: 'English', isHOD: false, targetWorkload: 6 },
  { name: 'Mr. Alister Fitzpatrick', abbreviation: 'AF', department: 'English', isHOD: false, targetWorkload: 24 },
  { name: 'Ms. Prini Sunil Kumar', abbreviation: 'PSK', department: 'Chemistry', isHOD: false, targetWorkload: 6 },
  // PHYSICS
  { name: 'Mr. Surendra Pd. Karnasah', abbreviation: 'SPK', department: 'Physics', isHOD: true, targetWorkload: 24 },
  { name: 'Mr. Bishnu Datt Badu', abbreviation: 'BDB', department: 'Physics', isHOD: false, targetWorkload: 28 },
  { name: 'Mr. Buddhi Sagar Dotel', abbreviation: 'BSD', department: 'Physics', isHOD: false, targetWorkload: 25 },
  { name: 'Mr. Madan Kumar Gautam', abbreviation: 'MKG', department: 'Physics', isHOD: false, targetWorkload: 26 },
  { name: 'Ms. Rakhi Malik', abbreviation: 'RM', department: 'Chemistry', isHOD: false, targetWorkload: 24 },
  // CHEMISTRY
  { name: 'Ms. Sangeeta Khwaounjoo', abbreviation: 'SKH', department: 'Chemistry', isHOD: true, targetWorkload: 29 },
  { name: 'Mr. Pradip Kumar Rajak', abbreviation: 'PKR', department: 'Chemistry', isHOD: false, targetWorkload: 29 },
  // BIOLOGY
  { name: 'Mr. Krishna Kumar Sinha', abbreviation: 'KKS', department: 'Biology', isHOD: true, targetWorkload: 25 },
  { name: 'Ms. Elhaam Abbas', abbreviation: 'EA', department: 'Biology', isHOD: false, targetWorkload: 28 },
  { name: 'Ms. Neeraj Soni Sharma', abbreviation: 'NSS', department: 'Biology', isHOD: false, targetWorkload: 25 },
  { name: 'Ms. Purnima Kiran Sharma', abbreviation: 'PKS', department: 'Biology', isHOD: false, targetWorkload: 27 },
  { name: 'Ms. Ranu Roy', abbreviation: 'RR', department: 'Biology', isHOD: false, targetWorkload: 27 },
  { name: 'Ms. Deepa Dutta', abbreviation: 'DD', department: 'Biology', isHOD: false, targetWorkload: 30 },
  // MATHEMATICS
  { name: 'Mr. Awlesh Prasad', abbreviation: 'AP', department: 'Mathematics', isHOD: true, targetWorkload: 25 },
  { name: 'Mr. Anil Kumar Jha', abbreviation: 'AKJ', department: 'Mathematics', isHOD: false, targetWorkload: 17 },
  { name: 'Mr. Neeraj Kumar Karna', abbreviation: 'NK', department: 'Mathematics', isHOD: false, targetWorkload: 28 },
  { name: 'Mr. Dilip Kumar Mishra', abbreviation: 'DKM', department: 'Mathematics', isHOD: false, targetWorkload: 26 },
  { name: 'Mr. Rajesh Shrestha', abbreviation: 'RS1', department: 'Mathematics', isHOD: false, targetWorkload: 25 },
  { name: 'Mr. Deepak Tamang', abbreviation: 'DT', department: 'Mathematics', isHOD: false, targetWorkload: 27 },
  { name: 'Mr. Kailash Kumar Karna', abbreviation: 'KKK', department: 'Mathematics', isHOD: false, targetWorkload: 26 },
  { name: 'Mr. Satnam Singh', abbreviation: 'SS', department: 'Mathematics', isHOD: false, targetWorkload: 24 },
  { name: 'Ms. Sasmita Rout', abbreviation: 'SR', department: 'Mathematics', isHOD: false, targetWorkload: 26 },
  { name: 'Ms. Jigisha Sharma', abbreviation: 'JS1', department: 'Mathematics', isHOD: false, targetWorkload: 26 },
  { name: 'Ms. Meera Roka', abbreviation: 'MR', department: 'Mathematics', isHOD: false, targetWorkload: 8 },
  { name: 'Ms. Kavita Shrestha', abbreviation: 'KS', department: 'Mathematics', isHOD: false, targetWorkload: 17 },
  { name: 'Ms. Megha Agrawal', abbreviation: 'MA', department: 'Mathematics', isHOD: false, targetWorkload: 29 },
  // HINDI
  { name: 'Ms. Usha Sharma', abbreviation: 'US', department: 'Hindi', isHOD: true, targetWorkload: 24 },
  { name: 'Ms. Nisha Jaiswal', abbreviation: 'NJ', department: 'Hindi', isHOD: false, targetWorkload: 24 },
  { name: 'Ms. Ritu Sharma', abbreviation: 'RS2', department: 'Hindi', isHOD: false, targetWorkload: 24 },
  { name: 'Ms. Ganga MB Chhetri', abbreviation: 'GC', department: 'Hindi', isHOD: false, targetWorkload: 24 },
  { name: 'Ms. Pooja Rawal', abbreviation: 'PR', department: 'Hindi', isHOD: false, targetWorkload: 29 },
  // NEPALI
  { name: 'Ms. Parmilla Malla', abbreviation: 'PM', department: 'Nepali', isHOD: true, targetWorkload: 27 },
  { name: 'Ms. Deepa Devi Subedi', abbreviation: 'DS2', department: 'Nepali', isHOD: false, targetWorkload: 27 },
  { name: 'Mr. Awatar Subedi', abbreviation: 'AS2', department: 'Nepali', isHOD: false, targetWorkload: 29 },
  { name: 'Ms. Kamala Gnawali', abbreviation: 'KG', department: 'Nepali', isHOD: false, targetWorkload: 29 },
  { name: 'Mr. Jit Bahadur Khadka', abbreviation: 'JBK', department: 'Nepali', isHOD: false, targetWorkload: 27 },
  { name: 'Mr. Ajay Gautam', abbreviation: 'AG', department: 'Nepali', isHOD: false, targetWorkload: 30 },
  { name: 'Ms. Amrita Silwal', abbreviation: 'AS3', department: 'Nepali', isHOD: false, targetWorkload: 30 },
  // COMMERCE
  { name: 'Mr. Raghubir Jha', abbreviation: 'RBJ', department: 'Commerce', isHOD: true, targetWorkload: 30 },
  { name: 'Ms. Teeny Chowdhury Das', abbreviation: 'TC', department: 'Commerce', isHOD: false, targetWorkload: 28 },
  { name: 'Ms. Priti Khator', abbreviation: 'PK', department: 'Commerce', isHOD: false, targetWorkload: 30 },
  { name: 'Ms. Pratichha Thapa', abbreviation: 'PT', department: 'Commerce', isHOD: false, targetWorkload: 28 },
  // ECONOMICS
  { name: 'Mr. Pankaj Sharma', abbreviation: 'PS', department: 'Economics', isHOD: true, targetWorkload: 27 },
  { name: 'Mr. Binod Poudel', abbreviation: 'BP', department: 'Economics', isHOD: false, targetWorkload: 29 },
  { name: 'Ms. Priyanka Pradhan', abbreviation: 'PP', department: 'Economics', isHOD: false, targetWorkload: 28 },
  // SOCIAL STUDIES
  { name: 'Dr. S.S. Baral', abbreviation: 'SSB', department: 'Social Studies', isHOD: true, targetWorkload: 20 },
  { name: 'Ms. Dilmaya Gurung', abbreviation: 'DG', department: 'Social Studies', isHOD: false, targetWorkload: 30 },
  { name: 'Ms. Geeta Devi Khanal', abbreviation: 'GK', department: 'Social Studies', isHOD: false, targetWorkload: 28 },
  { name: 'Ms. Kamala Chand', abbreviation: 'KC', department: 'Social Studies', isHOD: false, targetWorkload: 28 },
  { name: 'Ms. Kamlesh Thapa Khadka', abbreviation: 'KT', department: 'Social Studies', isHOD: false, targetWorkload: 27 },
  { name: 'Mr. Achyut Raj Sharma', abbreviation: 'ARS', department: 'Social Studies', isHOD: false, targetWorkload: 30 },
  { name: 'Ms. Sweta Jain', abbreviation: 'SJ', department: 'Social Studies', isHOD: false, targetWorkload: 30 },
  // HOME SCIENCE
  { name: 'Ms. Lalita Khadka', abbreviation: 'LK', department: 'Home Science', isHOD: false, targetWorkload: 26 },
  // COMPUTER SCIENCE
  { name: 'Mr. Pradip Kumar Thakur', abbreviation: 'PKT', department: 'Computer Science', isHOD: true, targetWorkload: 27 },
  { name: 'Mr. Bibek Khadka', abbreviation: 'BK', department: 'Computer Science', isHOD: false, targetWorkload: 34 },
  { name: 'Ms. Devi Roka Karki', abbreviation: 'DRK', department: 'Computer Science', isHOD: false, targetWorkload: 27 },
  { name: 'Mr. Raman Khadka', abbreviation: 'RK2', department: 'Computer Science', isHOD: false, targetWorkload: 31 },
  { name: 'Mr. Santosh Nepal', abbreviation: 'SN', department: 'Computer Science', isHOD: false, targetWorkload: 27 },
  { name: 'Ms. Ponmani A', abbreviation: 'PA', department: 'Computer Science', isHOD: false, targetWorkload: 31 },
  // FRENCH
  { name: 'Ms. Jyoti Shakya', abbreviation: 'JS2', department: 'French', isHOD: false, targetWorkload: 15 },
  // ART
  { name: 'Mr. Raja Man Karmacharya', abbreviation: 'RMK', department: 'Art', isHOD: true, targetWorkload: 22 },
  { name: 'Mr. Manoj Shakya Panju', abbreviation: 'MSP', department: 'Art', isHOD: false, targetWorkload: 29 },
  // SPORTS
  { name: 'Mr. Dev Raj Anand', abbreviation: 'DRA', department: 'Sports', isHOD: true,  targetWorkload: 37 },
  { name: 'Mr. Naresh Rawal', abbreviation: 'NR',  department: 'Sports', isHOD: false, targetWorkload: 37 },
  { name: 'Mr. Bijaya Kumar Khatri', abbreviation: 'BKK', department: 'Sports', isHOD: false, targetWorkload: 37 },
  { name: 'Mr. Prashant Maharjan', abbreviation: 'PM2', department: 'Sports', isHOD: false, targetWorkload: 37 },
  { name: 'Mr. Abishek Basnet', abbreviation: 'AB',  department: 'Sports', isHOD: false, targetWorkload: 36 },
  { name: 'Mr. Dipris Muni Bajrachara', abbreviation: 'DMB', department: 'Sports', isHOD: false, targetWorkload: 36 },
  { name: 'Ms. Shraddha Timalsena', abbreviation: 'ST', department: 'Yoga', isHOD: false, targetWorkload: 34 },
  // LIBRARY
  { name: 'Ms. Poonam Mishra', abbreviation: 'PM3', department: 'Library', isHOD: false, targetWorkload: 42 },
  { name: 'Mr. Om Prakash Shah', abbreviation: 'OPS', department: 'Library', isHOD: false, targetWorkload: 20 },
  // MUSIC
  { name: 'Ms. Sangeeta Pradhan Rana', abbreviation: 'SPR', department: 'Music', isHOD: true, targetWorkload: 51 },
  { name: 'Mr. Hari Datt Phulara', abbreviation: 'HDP', department: 'Music', isHOD: false, targetWorkload: 30 },
  { name: 'Mr. Bruno Tamang', abbreviation: 'BTK', department: 'Music', isHOD: false, targetWorkload: 30 },
  { name: 'Ms. Bimla Maharjan', abbreviation: 'BM',  department: 'Dance', isHOD: true,  targetWorkload: 24 },
  { name: 'Ms. Kunti Simali',  abbreviation: 'KSM', department: 'Dance', isHOD: false, targetWorkload: 24 },
  { name: 'Mr. Sanjok Sharma', abbreviation: 'SSM', department: 'Music', isHOD: false, targetWorkload: 30 },
  { name: 'Mr. Yuson Maharjan', abbreviation: 'YM', department: 'Music', isHOD: false, targetWorkload: 30 },
  { name: 'Mr. Nirajan Tandukar', abbreviation: 'NT', department: 'Music', isHOD: false, targetWorkload: 30 },
  // LAB
  { name: 'Ms. Ajita Thapaliya', abbreviation: 'AT', department: 'Biology Lab', isHOD: false, targetWorkload: 30 },
  { name: 'Ms. Deepika Bhandari', abbreviation: 'DB', department: 'Biology Lab', isHOD: false, targetWorkload: 30 },
  { name: 'Mr. Sudhanshu Kumar Mishra', abbreviation: 'SKM', department: 'Physics Lab', isHOD: false, targetWorkload: 30 },
  { name: 'Mr. Rajnish Kumar Mishra', abbreviation: 'RKM', department: 'Chemistry Lab', isHOD: false, targetWorkload: 30 },
  { name: 'Ms. Alina Maharjan', abbreviation: 'AM', department: 'Biology Lab', isHOD: false, targetWorkload: 30 },
  { name: 'Mr. Ujjwal Maharjan', abbreviation: 'UM', department: 'Computer Lab', isHOD: false, targetWorkload: 40 },
  // COUNSELLOR
  { name: 'Dr. Samarpita Shoma Nath', abbreviation: 'SSN', department: 'Counselling', isHOD: false, targetWorkload: 20 },
];

// Class Teachers mapping from the PDF
const classTeachers: Record<string, string> = {
  'VIA': 'MR', 'VIB': 'RA', 'VIC': 'PA', 'VID': 'DD', 'VIE': 'KS',
  'VIIA': 'SR', 'VIIB': 'MA', 'VIIC': 'RK', 'VIID': 'SJ', 'VIIE': 'JS1',
  'VIIIA': 'AS1', 'VIIIB': 'BSD', 'VIIIC': 'MKG', 'VIIID': 'ARS', 'VIIIE': 'SN', 'VIIIF': 'KT',
  'IXA': 'RS1', 'IXB': 'RT', 'IXC': 'RM', 'IXD': 'SB', 'IXE': 'KKK', 'IXF': 'RK2',
  'XA': 'GK', 'XB': 'EA', 'XC': 'KC', 'XD': 'DT', 'XE': 'DKM',
  'XIA': 'BDB', 'XIB': 'PKR', 'XIC': 'DG', 'XID': 'SU', 'XIE': 'PP', 'XIF': 'RLC',
  'XIIA': 'SKH', 'XIIB': 'SPK', 'XIIC': 'LK', 'XIID': 'BP', 'XIIE': 'PS', 'XIIF': 'PK',
};

// Coordinators mapping
const coordinators: Record<string, string> = {
  'VIA': 'MR', 'VIB': 'MR', 'VIC': 'MR', 'VID': 'MR', 'VIE': 'MR',
  'VIIA': 'JS1', 'VIIB': 'JS1', 'VIIC': 'JS1', 'VIID': 'JS1', 'VIIE': 'JS1',
  'VIIIA': 'SN', 'VIIIB': 'SN', 'VIIIC': 'SN', 'VIIID': 'SN', 'VIIIE': 'SN', 'VIIIF': 'SN',
  'IXA': 'SB', 'IXB': 'SB', 'IXC': 'SB', 'IXD': 'SB', 'IXE': 'SB', 'IXF': 'SB',
  'XA': 'DKM', 'XB': 'DKM', 'XC': 'KC', 'XD': 'DKM', 'XE': 'DKM',
  'XIA': 'BDB', 'XIB': 'BDB', 'XIC': 'BDB', 'XID': 'BDB', 'XIE': 'BDB', 'XIF': 'BDB',
  'XIIA': 'SPK', 'XIIB': 'SPK', 'XIIC': 'SPK', 'XIID': 'SPK', 'XIIE': 'SPK', 'XIIF': 'SPK',
};

// Time slots for senior school
const seniorTimeSlots = [
  { periodNumber: 1, startTime: '8:05', endTime: '8:40', duration: 35, slotType: 'Regular' },
  { periodNumber: 2, startTime: '8:40', endTime: '9:15', duration: 35, slotType: 'Regular' },
  { periodNumber: 3, startTime: '9:30', endTime: '10:10', duration: 40, slotType: 'Regular' },
  { periodNumber: 4, startTime: '10:10', endTime: '10:50', duration: 40, slotType: 'Regular' },
  { periodNumber: 5, startTime: '10:50', endTime: '11:30', duration: 40, slotType: 'Regular' },
  { periodNumber: 6, startTime: '12:00', endTime: '12:35', duration: 35, slotType: 'Regular' },
  { periodNumber: 7, startTime: '12:35', endTime: '13:10', duration: 35, slotType: 'Regular' },
  { periodNumber: 8, startTime: '13:10', endTime: '13:45', duration: 35, slotType: 'Regular' },
];

// Days
const days = [
  { name: 'Sunday', dayOrder: 0 },
  { name: 'Monday', dayOrder: 1 },
  { name: 'Tuesday', dayOrder: 2 },
  { name: 'Wednesday', dayOrder: 3 },
  { name: 'Thursday', dayOrder: 4 },
  { name: 'Friday', dayOrder: 5 },
];

const roomSeeds = [
  { name: 'Physics Lab (IX-X)', subjects: ['Physics'], grades: ['IX', 'X'] },
  { name: 'Physics Lab (XI-XII)', subjects: ['Physics'], grades: ['XI', 'XII'] },
  { name: 'Chemistry Lab (IX-X)', subjects: ['Chemistry'], grades: ['IX', 'X'] },
  { name: 'Chemistry Lab (XI-XII)', subjects: ['Chemistry'], grades: ['XI', 'XII'] },
  { name: 'Biology Lab (IX-X)', subjects: ['Biology'], grades: ['IX', 'X'] },
  { name: 'Biology Lab (XI-XII) A', subjects: ['Biology'], grades: ['XI', 'XII'] },
  { name: 'Biology Lab (XI-XII) B', subjects: ['Biology'], grades: ['XI', 'XII'] },
  { name: 'Computer Lab 1', subjects: ['Computer Science', 'IP'], grades: null },
  { name: 'Computer Lab 2', subjects: ['Computer Science', 'IP'], grades: null },
  { name: 'Computer Lab 3', subjects: ['Computer Science', 'IP'], grades: null },
];

async function main() {
  console.log('Starting seed...');

  // Clear existing data
  await prisma.timetableSlot.deleteMany();
  await prisma.teacherAbsence.deleteMany();
  await prisma.teacherUnavailability.deleteMany();
  await prisma.subjectRoom.deleteMany();
  await prisma.room.deleteMany();
  await prisma.teacherSubject.deleteMany();
  await prisma.workloadValidation.deleteMany();
  await prisma.importHistory.deleteMany();
  await prisma.scoringWeights.deleteMany();
  await prisma.schoolConfig.deleteMany();
  await prisma.timeSlot.deleteMany();
  await prisma.day.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.section.deleteMany();
  await prisma.grade.deleteMany();

  console.log('Cleared existing data');

  // Create grades
  const gradeRecords = await Promise.all(
    grades.map(grade => prisma.grade.create({ data: grade }))
  );
  console.log(`Created ${gradeRecords.length} grades`);

  // Create sections
  const sectionRecords: Record<string, any> = {};
  for (const grade of gradeRecords) {
    const sectionData = sectionsPerGrade[grade.name] || [];
    for (const section of sectionData) {
      const record = await prisma.section.create({
        data: {
          name: section.name,
          gradeId: grade.id,
          stream: section.stream,
        },
      });
      sectionRecords[section.name] = record;
    }
  }
  console.log(`Created ${Object.keys(sectionRecords).length} sections`);

  // Create subjects
  const subjectRecords = await Promise.all(
    subjects.map(subject => prisma.subject.create({ data: subject }))
  );
  console.log(`Created ${subjectRecords.length} subjects`);

  // Create lab rooms and subject-room mappings
  const subjectByName = new Map(subjectRecords.map(s => [s.name, s]));
  for (const room of roomSeeds) {
    const createdRoom = await prisma.room.create({
      data: {
        name: room.name,
        grades: room.grades === null ? Prisma.JsonNull : room.grades,
      },
    });
    for (const subjectName of room.subjects) {
      const resolvedName = subjectName === 'IP' ? 'Informatics Practices' : subjectName;
      const subject = subjectByName.get(resolvedName);
      if (!subject) continue;
      await prisma.subjectRoom.create({
        data: { subjectId: subject.id, roomId: createdRoom.id },
      });
    }
  }
  console.log(`Created ${roomSeeds.length} rooms with subject mappings`);

  // Create teachers
  const teacherRecords: Record<string, any> = {};
  for (const teacher of teachers) {
    const grades = teachableGrades[teacher.abbreviation] ?? [];
    const record = await prisma.teacher.create({
      data: { ...teacher, teachableGrades: JSON.stringify(grades) },
    });
    teacherRecords[teacher.abbreviation] = record;
  }
  console.log(`Created ${Object.keys(teacherRecords).length} teachers`);

  // Update class teachers
  for (const [sectionName, teacherAbbr] of Object.entries(classTeachers)) {
    const section = sectionRecords[sectionName];
    const teacher = teacherRecords[teacherAbbr];
    if (section && teacher) {
      await prisma.section.update({
        where: { id: section.id },
        data: { classTeacherId: teacher.id },
      });
    }
  }
  console.log('Updated class teachers');

  // Update coordinators
  for (const [sectionName, teacherAbbr] of Object.entries(coordinators)) {
    const section = sectionRecords[sectionName];
    const teacher = teacherRecords[teacherAbbr];
    if (section && teacher) {
      await prisma.section.update({
        where: { id: section.id },
        data: { coordinatorId: teacher.id },
      });
    }
  }
  console.log('Updated coordinators');

  // Create time slots
  const timeSlotRecords = await Promise.all(
    seniorTimeSlots.map(slot => prisma.timeSlot.create({ data: slot }))
  );
  console.log(`Created ${timeSlotRecords.length} time slots`);

  // Create days
  const dayRecords = await Promise.all(
    days.map(day => prisma.day.create({ data: day }))
  );
  console.log(`Created ${dayRecords.length} days`);

  // Create school config
  await prisma.schoolConfig.create({
    data: {
      schoolName: 'Modern Indian School',
      academicYear: '2026-27',
    },
  });
  console.log('Created school config');

  await prisma.scoringWeights.create({
    data: {
      name: 'default',
      subjectPreferenceWeight: 2.0,
      teacherDailyLoadWeight: 1.5,
      sectionDailyLoadWeight: 1.0,
      subjectSpreadWeight: 1.5,
      teacherAdjacencyPenaltyWeight: 1.2,
      labLastPeriodPenaltyWeight: 1.0,
      classTeacherBonusWeight: 0.8,
      roomAvailabilityWeight: 1.0,
      labPlacementWeight: 2.0,
    },
  });
  console.log('Created default scoring weights');

  // Create teacher-subject assignments for automated timetable generation
  console.log('Creating teacher-subject assignments...');
  
  const subjectMap: Record<string, string> = {};
  subjectRecords.forEach(s => { subjectMap[s.name] = s.id; });
  
  const assignments = [
    // English assignments
    { teacher: 'ABF', subject: 'English', sections: ['XIIA', 'XIIB', 'XIIE'], periodsPerWeek: 6 },
    { teacher: 'BL', subject: 'English', sections: ['XIIC', 'XIC'], periodsPerWeek: 6 },
    { teacher: 'SU', subject: 'English', sections: ['XIIF', 'XIA', 'IXF'], periodsPerWeek: 6 },
    // RLC: XIIC, XIE, XIF at 5ppw; XA reduced to 4ppw
    { teacher: 'RLC', subject: 'English', sections: ['XIIC', 'XIE', 'XIF'], periodsPerWeek: 5 },
    { teacher: 'RLC', subject: 'English', sections: ['XA'], periodsPerWeek: 4 },
    { teacher: 'SB', subject: 'English', sections: ['XE', 'IXD', 'VIIIC', 'VIIIF'], periodsPerWeek: 5 },
    // RT: IXB, VIIID at 6ppw; XB reduced to 5ppw
    { teacher: 'RT', subject: 'English', sections: ['IXB', 'VIIID'], periodsPerWeek: 6 },
    { teacher: 'RT', subject: 'English', sections: ['XB'], periodsPerWeek: 5 },
    { teacher: 'AS1', subject: 'English', sections: ['XD', 'IXA', 'IXE', 'VIIIA'], periodsPerWeek: 5 },
    { teacher: 'RK', subject: 'English', sections: ['VIIB', 'VIIC', 'VIID', 'VIIE', 'VIIIE'], periodsPerWeek: 5 },
    { teacher: 'FBA', subject: 'English', sections: ['VIA', 'VIE'], periodsPerWeek: 5 },
    { teacher: 'RA', subject: 'English', sections: ['VIB'], periodsPerWeek: 5 },
    { teacher: 'DS1', subject: 'English', sections: ['XIB', 'XC', 'IXC'], periodsPerWeek: 5 },
    
    // Physics assignments
    { teacher: 'SPK', subject: 'Physics', sections: ['XIIB', 'XIB'], periodsPerWeek: 6 },
    // BDB: XIIA & XIA at 6ppw; XA reduced to 4 to stay within 48-period cap
    { teacher: 'BDB', subject: 'Physics', sections: ['XIIA', 'XIA'], periodsPerWeek: 6 },
    { teacher: 'BDB', subject: 'Physics', sections: ['XA'], periodsPerWeek: 4 },
    { teacher: 'BSD', subject: 'Physics', sections: ['XD', 'XE', 'IXA', 'IXB', 'IXF', 'VIIIB'], periodsPerWeek: 4 },
    // MKG: XB, XC, IXC, IXD, IXE, VIIIC (6×4=24, target 26)
    { teacher: 'MKG', subject: 'Physics', sections: ['XC', 'IXC', 'IXD', 'IXE', 'VIIIC'], periodsPerWeek: 4 },
    // MKG's XB reduced to 3ppw to stay within XB's 48-period cap
    { teacher: 'MKG', subject: 'Physics', sections: ['XB'], periodsPerWeek: 3 },
    // RM takes IXF, VIID (removed XE — BSD covers it)
    { teacher: 'RM', subject: 'Physics', sections: ['IXF', 'VIID'], periodsPerWeek: 4 },

    // Chemistry assignments
    // SKH: XIIA & XIA at 6ppw; XA at 5ppw
    { teacher: 'SKH', subject: 'Chemistry', sections: ['XIIA', 'XIA'], periodsPerWeek: 6 },
    { teacher: 'SKH', subject: 'Chemistry', sections: ['XA'], periodsPerWeek: 5 },
    // PKR: XIIB & XIB at 6ppw; XB at 5ppw
    { teacher: 'PKR', subject: 'Chemistry', sections: ['XIIB', 'XIB'], periodsPerWeek: 6 },
    { teacher: 'PKR', subject: 'Chemistry', sections: ['XB'], periodsPerWeek: 5 },

    // Biology/Science assignments
    // KKS: XIIA, XD, IXA at 6ppw; XA reduced to 4ppw
    { teacher: 'KKS', subject: 'Biology', sections: ['XIIA', 'XD', 'IXA'], periodsPerWeek: 6 },
    { teacher: 'KKS', subject: 'Biology', sections: ['XA'], periodsPerWeek: 4 },
    // EA: XIA 4ppw (two lab doubles); VIIB/VIIC 5ppw
    { teacher: 'EA', subject: 'Biology', sections: ['XIA'], periodsPerWeek: 4 },
    { teacher: 'EA', subject: 'Biology', sections: ['VIIB', 'VIIC'], periodsPerWeek: 5 },
    { teacher: 'EA', subject: 'Biology', sections: ['XB'], periodsPerWeek: 4 },
    { teacher: 'NSS', subject: 'Biology', sections: ['XC', 'IXB', 'IXC', 'VIIID', 'VIIIE'], periodsPerWeek: 4 },
    { teacher: 'PKS', subject: 'Biology', sections: ['XE', 'IXD', 'IXE', 'IXF', 'VIIIA', 'VIIIF'], periodsPerWeek: 4 },
    { teacher: 'RR', subject: 'Science', sections: ['VIIE', 'VIA', 'IXA', 'IXB'], periodsPerWeek: 4 },
    { teacher: 'DD', subject: 'Science', sections: ['XD', 'VIIIF', 'VID'], periodsPerWeek: 5 },
    { teacher: 'PSK', subject: 'Science', sections: ['VIC'], periodsPerWeek: 5 },
    
    // Mathematics assignments
    { teacher: 'AP', subject: 'Mathematics', sections: ['XIID', 'IXC', 'VIIIA'], periodsPerWeek: 6 },
    // AKJ: IXB at 6ppw; XA reduced to 5ppw
    { teacher: 'AKJ', subject: 'Mathematics', sections: ['IXB'], periodsPerWeek: 6 },
    { teacher: 'AKJ', subject: 'Mathematics', sections: ['XA'], periodsPerWeek: 5 },
    { teacher: 'NK', subject: 'Mathematics', sections: ['XIIA', 'XIB', 'XB'], periodsPerWeek: 6 },
    { teacher: 'DKM', subject: 'Mathematics', sections: ['XC', 'XE', 'VIIIB'], periodsPerWeek: 6 },
    { teacher: 'RS1', subject: 'Mathematics', sections: ['XIIB', 'IXA', 'VIIIC'], periodsPerWeek: 6 },
    { teacher: 'DT', subject: 'Mathematics', sections: ['XIA', 'XD', 'IXD'], periodsPerWeek: 6 },
    { teacher: 'KKK', subject: 'Mathematics', sections: ['XID', 'IXE', 'VIIID'], periodsPerWeek: 6 },
    { teacher: 'SS', subject: 'Mathematics', sections: ['VIIIE', 'VIIA', 'VIIB'], periodsPerWeek: 6 },
    { teacher: 'SR', subject: 'Mathematics', sections: ['VIIC', 'VIID', 'VIC'], periodsPerWeek: 5 },
    { teacher: 'JS1', subject: 'Mathematics', sections: ['IXF', 'VIIIF', 'VIIE'], periodsPerWeek: 5 },
    { teacher: 'MR', subject: 'Mathematics', sections: ['VIA'], periodsPerWeek: 5 },
    { teacher: 'KS', subject: 'Mathematics', sections: ['VIE'], periodsPerWeek: 5 },
    // MA does NOT take VIA (MR's sole section) or VIIB (SS's section)
    { teacher: 'MA', subject: 'Mathematics', sections: ['VIB', 'VID'], periodsPerWeek: 5 },
    
    // Hindi assignments
    { teacher: 'US', subject: 'Hindi', sections: ['XA', 'XB', 'IXA', 'IXB', 'IXC', 'VIIIA', 'VIIA', 'VIA'], periodsPerWeek: 3 },
    // 'VE' is not a valid section name (removed); 8 sections × 3 = 24 ✓
    { teacher: 'NJ', subject: 'Hindi', sections: ['XC', 'XD', 'VID', 'VIIIB', 'VIIIF', 'VIIB', 'VIB'], periodsPerWeek: 3 },
    { teacher: 'RS2', subject: 'Hindi', sections: ['IXD', 'IXE', 'IXF', 'VIID', 'VIIE', 'VIIID', 'VIIIE', 'VIIIF', 'VIE'], periodsPerWeek: 3 },
    { teacher: 'GC', subject: 'Hindi', sections: ['VIIID', 'VIIIE', 'VIIIF', 'VIIA', 'VIIB', 'VIIC', 'VIID', 'VID'], periodsPerWeek: 3 },
    { teacher: 'PR', subject: 'Hindi', sections: ['XE', 'VIIIA', 'VIIIB', 'VIIIC', 'VIA', 'VIIB', 'VIIC', 'VIIIC', 'VIIIF', 'VIC'], periodsPerWeek: 3 },
    
    // Nepali assignments
    // PM: IXA, VIIIA, VIA at 5ppw; XA reduced to 3ppw
    { teacher: 'PM', subject: 'Nepali', sections: ['IXA', 'VIIIA', 'VIA'], periodsPerWeek: 5 },
    { teacher: 'PM', subject: 'Nepali', sections: ['XA'], periodsPerWeek: 3 },
    // Removed duplicate VIIIB
    { teacher: 'DS2', subject: 'Nepali', sections: ['XB', 'IXB', 'VIIIB', 'VIIB', 'VIIIA'], periodsPerWeek: 4 },
    { teacher: 'AS2', subject: 'Nepali', sections: ['XC', 'IXC', 'VIIIC', 'VIC', 'VIIA'], periodsPerWeek: 4 },
    { teacher: 'KG', subject: 'Nepali', sections: ['XE', 'IXE', 'VIIIE', 'VIIE', 'VIE'], periodsPerWeek: 4 },
    { teacher: 'JBK', subject: 'Nepali', sections: ['XD', 'IXD', 'VIID', 'VID', 'VIIE'], periodsPerWeek: 4 },
    { teacher: 'AG', subject: 'Nepali', sections: ['IXF', 'VIIIF', 'VIIC', 'VIIIC', 'VIID', 'VIB', 'VIC', 'VID'], periodsPerWeek: 3 },
    { teacher: 'AS3', subject: 'Nepali', sections: ['VIIID', 'VIIC', 'VIB', 'VIIIE', 'VIIE', 'VIIA', 'VIE', 'VIA'], periodsPerWeek: 3 },
    
    // Commerce assignments
    { teacher: 'RBJ', subject: 'Accountancy', sections: ['XIIE', 'XID', 'XIE'], periodsPerWeek: 8 },
    { teacher: 'PK', subject: 'Accountancy', sections: ['XIIF', 'XIID', 'XIF'], periodsPerWeek: 8 },
    { teacher: 'TC', subject: 'Business Studies', sections: ['XIIE', 'XIIF', 'XIID'], periodsPerWeek: 6 },
    { teacher: 'PT', subject: 'Business Studies', sections: ['XID', 'XIE', 'XIF'], periodsPerWeek: 6 },
    
    // Economics assignments
    { teacher: 'PS', subject: 'Economics', sections: ['XIIE', 'XIIF', 'XID'], periodsPerWeek: 6 },
    { teacher: 'BP', subject: 'Economics', sections: ['XIID', 'XIF', 'XA', 'XB', 'XC', 'XD', 'XE'], periodsPerWeek: 3 },
    { teacher: 'PP', subject: 'Economics', sections: ['XIIB', 'XIIC', 'XIE', 'XIB', 'XIC'], periodsPerWeek: 4 },
    
    // Social Studies/Geography/History assignments
    // SSB: XIIC, XIIF at 6ppw; XA reduced to 3ppw
    { teacher: 'SSB', subject: 'Geography', sections: ['XIIC', 'XIIF'], periodsPerWeek: 6 },
    { teacher: 'SSB', subject: 'Geography', sections: ['XA'], periodsPerWeek: 3 },
    { teacher: 'BL', subject: 'History', sections: ['XIIC', 'XIC'], periodsPerWeek: 5 },
    // DG: XIC, VIIIA, VIIIC only (XB/XC/XD/XE removed — GK and KC handle X grade)
    { teacher: 'DG', subject: 'Social Studies', sections: ['XIC', 'VIIIA', 'VIIIC'], periodsPerWeek: 3 },
    { teacher: 'GK', subject: 'Social Studies', sections: ['XA', 'XB', 'IXA', 'IXB', 'VIIA'], periodsPerWeek: 4 },
    // KC: XC, XD but NOT XB (GK has it); IXC, IXD, VIIIB
    { teacher: 'KC', subject: 'Social Studies', sections: ['XC', 'XD', 'IXC', 'IXD', 'VIIIB'], periodsPerWeek: 4 },
    { teacher: 'KT', subject: 'Social Studies', sections: ['XE', 'IXE', 'IXF', 'VIIIF'], periodsPerWeek: 4 },
    { teacher: 'ARS', subject: 'Social Studies', sections: ['VIIID', 'VIIC', 'VIIE', 'VIB', 'VIC'], periodsPerWeek: 4 },
    { teacher: 'SJ', subject: 'Social Studies', sections: ['VIIIE', 'VIID', 'VIE', 'VID'], periodsPerWeek: 4 },
    
    // Home Science assignments
    { teacher: 'LK', subject: 'Home Science', sections: ['XIIA', 'XIIC', 'XIIF', 'XIA', 'XIC', 'VIIA'], periodsPerWeek: 4 },
    
    // Computer Science assignments
    { teacher: 'PKT', subject: 'Computer Science', sections: ['XIIB', 'XIIE', 'XIIC', 'XIIF'], periodsPerWeek: 5 },
    { teacher: 'BK', subject: 'Computer Science', sections: ['XIB', 'XIC', 'XIF', 'IXA', 'IXB'], periodsPerWeek: 4 },
    { teacher: 'DRK', subject: 'Computer Science', sections: ['XIIA', 'XIE', 'XA', 'XB', 'XC'], periodsPerWeek: 4 },
    { teacher: 'RK2', subject: 'Computer Science', sections: ['XIA', 'XD', 'XE', 'IXC', 'IXD', 'IXE', 'IXF'], periodsPerWeek: 3 },
    { teacher: 'SN', subject: 'Computer Science', sections: ['VIIIA', 'VIIIB', 'VIIIC', 'VIIID', 'VIIIE', 'VIIIF', 'VIIA', 'VIIB', 'VIIC', 'VIID'], periodsPerWeek: 2 },
    { teacher: 'PA', subject: 'Computer Science', sections: ['VIIE', 'VIA', 'VIB', 'VIC', 'VID', 'VIE'], periodsPerWeek: 3 },
    
    // French assignments
    { teacher: 'JS2', subject: 'French', sections: ['VIIIA', 'VIIIB', 'VIIIC', 'VIIID', 'VIIIE', 'VIIIF', 'VIIA', 'VIIB', 'VIIC', 'VIID', 'VIIE', 'VIA', 'VIB', 'VIC', 'VID', 'VIE'], periodsPerWeek: 1 },
    
    // ── W.E. (Work Experience) assignments ────────────────────────────────────
    // Rules:
    //   • Each section gets exactly ONE W.E. subject (Dance / Art / Music).
    //   • Multiple sections may share the same time slot — each uses a DIFFERENT teacher.
    //   • Teacher conflict is enforced: a W.E. teacher handles one section at a time.
    //   • Only classes VI–IX have W.E.; X/XI/XII are blocked in isAvailable.
    //
    // Section → W.E. subject mapping (by section letter):
    //   A, D → Dance     (BM for VI–VIII; KSM for VIII-D onward + IX)
    //   B, E → Music     (SPR for VI–VII; HDP for VIII; BTK for IX; NT for VI-E)
    //   C, F → Art       (RMK for VI–VII; MSP for VIII–IX)
    //
    // Dance — Ms. Bimla Maharjan (BM) + Ms. Kunti Simali (KSM)
    { teacher: 'BM',  subject: 'Dance', sections: ['VIA', 'VID', 'VIIA', 'VIID', 'VIIIA'], periodsPerWeek: 1 },
    { teacher: 'KSM', subject: 'Dance', sections: ['VIIID', 'IXA', 'IXD'],                 periodsPerWeek: 1 },

    // Art — Mr. Raja Man Karmacharya (RMK) + Mr. Manoj Shakya Panju (MSP)
    { teacher: 'RMK', subject: 'Art', sections: ['VIC', 'VIIC'],                                 periodsPerWeek: 1 },
    { teacher: 'MSP', subject: 'Art', sections: ['VIIIC', 'VIIIF', 'IXC', 'IXF'],               periodsPerWeek: 1 },

    // Music (Vocal / Instrumental) — SPR, HDP, BTK, NT
    // Each section gets exactly one Music teacher (no duplicates across teachers).
    { teacher: 'SPR', subject: 'Music', sections: ['VIB', 'VIIB', 'VIIE'],  periodsPerWeek: 1 },
    { teacher: 'NT',  subject: 'Music', sections: ['VIE', 'VIID'],          periodsPerWeek: 1 },
    { teacher: 'HDP', subject: 'Music', sections: ['VIIIB', 'VIIIE', 'IXB'], periodsPerWeek: 1 },
    { teacher: 'BTK', subject: 'Music', sections: ['IXE'],                   periodsPerWeek: 1 },
    
    // Yoga — ST assigned to VI–X only (XI and XII have no Yoga periods).
    // No workload cap applies to ST for Yoga — she covers all eligible sections.
    { teacher: 'ST', subject: 'Yoga', sections: [
      'VIA', 'VIB', 'VIC', 'VID', 'VIE',
      'VIIA', 'VIIB', 'VIIC', 'VIID', 'VIIE',
      'VIIIA', 'VIIIB', 'VIIIC', 'VIIID', 'VIIIE', 'VIIIF',
      'IXA', 'IXB', 'IXC', 'IXD', 'IXE', 'IXF',
      'XA', 'XB', 'XC', 'XD', 'XE',
    ], periodsPerWeek: 1 },

    // Library — single department, works as a pool (PM3 + OPS).
    // Students just see "Library" — no specific teacher displayed per section.
    // Library is in SHARED_SLOT_SUBJECTS so teacher conflict is NOT enforced;
    // multiple sections can have Library at the same slot (both librarians are present).
    // Both teachers are assigned to all 40 sections so the scheduler can pick either.
    { teacher: 'PM3', subject: 'Library', sections: [
      'VIA', 'VIB', 'VIC', 'VID', 'VIE',
      'VIIA', 'VIIB', 'VIIC', 'VIID', 'VIIE',
      'VIIIA', 'VIIIB', 'VIIIC', 'VIIID', 'VIIIE', 'VIIIF',
      'IXA', 'IXB', 'IXC', 'IXD', 'IXE', 'IXF',
      'XA', 'XB', 'XC', 'XD', 'XE',
      'XIA', 'XIB', 'XIC', 'XID', 'XIE', 'XIF',
      'XIIA', 'XIIB', 'XIIC', 'XIID', 'XIIE', 'XIIF',
    ], periodsPerWeek: 1 },
    { teacher: 'OPS', subject: 'Library', sections: [
      'VIA', 'VIB', 'VIC', 'VID', 'VIE',
      'VIIA', 'VIIB', 'VIIC', 'VIID', 'VIIE',
      'VIIIA', 'VIIIB', 'VIIIC', 'VIIID', 'VIIIE', 'VIIIF',
      'IXA', 'IXB', 'IXC', 'IXD', 'IXE', 'IXF',
      'XA', 'XB', 'XC', 'XD', 'XE',
      'XIA', 'XIB', 'XIC', 'XID', 'XIE', 'XIF',
      'XIIA', 'XIIB', 'XIIC', 'XIID', 'XIIE', 'XIIF',
    ], periodsPerWeek: 1 },

    // Games — sports teachers assigned to all sections (2 periods each)
    // Using 5 teachers to spread; each gets 8 sections × 2 = 16 periods (target 36 filled via Phase 2 top-up)
    { teacher: 'DRA', subject: 'Games', sections: ['VIA', 'VIB', 'VIC', 'VID', 'VIE', 'VIIA', 'VIIB', 'VIIC'], periodsPerWeek: 2 },
    { teacher: 'NR',  subject: 'Games', sections: ['VIID', 'VIIE', 'VIIIA', 'VIIIB', 'VIIIC', 'VIIID', 'VIIIE'], periodsPerWeek: 2 },
    { teacher: 'BKK', subject: 'Games', sections: ['VIIIF', 'IXA', 'IXB', 'IXC', 'IXD', 'IXE', 'IXF', 'XA'], periodsPerWeek: 2 },
    { teacher: 'PM2', subject: 'Games', sections: ['XB', 'XC', 'XD', 'XE', 'XIA', 'XIB', 'XIC', 'XID'], periodsPerWeek: 2 },
    { teacher: 'AB',  subject: 'Games', sections: ['XIE', 'XIF', 'XIIA', 'XIIB', 'XIIC', 'XIID', 'XIIE', 'XIIF'], periodsPerWeek: 2 },

    // Lab assistants - support Science/Physics/Chemistry/Biology
    { teacher: 'AT', subject: 'Science', sections: ['VIA', 'VIB', 'VIC', 'VID', 'VIE'], periodsPerWeek: 1 },
    { teacher: 'DB', subject: 'Science', sections: ['VIIA', 'VIIB', 'VIIC', 'VIID', 'VIIE'], periodsPerWeek: 1 },
    { teacher: 'SKM', subject: 'Physics', sections: ['IXA', 'IXB', 'IXC', 'IXD', 'IXE', 'IXF'], periodsPerWeek: 1 },
    { teacher: 'RKM', subject: 'Chemistry', sections: ['IXA', 'IXB', 'IXC', 'IXD', 'IXE', 'IXF'], periodsPerWeek: 1 },
    { teacher: 'AM', subject: 'Biology', sections: ['IXA', 'IXB', 'IXC', 'IXD', 'IXE', 'IXF'], periodsPerWeek: 1 },

    // Innovation — exactly 1 period per section per week (hard constraint R5-fixed).
    // VI–VIII: UM (lab/innovation incharge for junior school)
    { teacher: 'UM', subject: 'Innovation', sections: ['VIA', 'VIB', 'VIC', 'VID', 'VIE', 'VIIA', 'VIIB', 'VIIC', 'VIID', 'VIIE', 'VIIIA', 'VIIIB', 'VIIIC', 'VIIID', 'VIIIE', 'VIIIF'], periodsPerWeek: 1 },
    // IX–X: RS1 (grade IX coordinator) and DKM (grade X coordinator) as Innovation incharges
    { teacher: 'RS1', subject: 'Innovation', sections: ['IXA', 'IXB', 'IXC', 'IXD', 'IXE', 'IXF'], periodsPerWeek: 1 },
    { teacher: 'DKM', subject: 'Innovation', sections: ['XA', 'XB', 'XC', 'XD', 'XE'], periodsPerWeek: 1 },
    // XI–XII: BDB (XI coordinator) and SPK (XII coordinator) as Innovation incharges
    { teacher: 'BDB', subject: 'Innovation', sections: ['XIA', 'XIB', 'XIC', 'XID', 'XIE', 'XIF'], periodsPerWeek: 1 },
    { teacher: 'SPK', subject: 'Innovation', sections: ['XIIA', 'XIIB', 'XIIC', 'XIID', 'XIIE', 'XIIF'], periodsPerWeek: 1 },
  ];
  
  let assignmentCount = 0;
  for (const assignment of assignments) {
    const teacher = teacherRecords[assignment.teacher];
    const subject = subjectRecords.find(s => s.name === assignment.subject);
    
    if (teacher && subject) {
      for (const sectionName of assignment.sections) {
        const section = sectionRecords[sectionName];
        if (section) {
          try {
            await prisma.teacherSubject.create({
              data: {
                teacherId: teacher.id,
                subjectId: subject.id,
                sectionId: section.id,
                periodsPerWeek: assignment.periodsPerWeek,
              },
            });
            assignmentCount++;
          } catch (e) {
            // Skip duplicates
          }
        }
      }
    }
  }
  console.log(`Created ${assignmentCount} teacher-subject assignments`);

  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
