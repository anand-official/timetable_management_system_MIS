/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Migration: 2025-26 → 2026-27
 *
 * Changes:
 * 1. Adds new section XF (Grade X)
 * 2. Adds new teacher: Mr. Alister Fitzpatrick (English)
 * 3. Adds new teacher: Mr. Dipris Muni Bajrachara (Sports)
 * 4. Updates targetWorkload for all teachers
 * 5. Rebuilds TeacherSubject assignments from 2026-27 workload
 * 6. Updates class teacher assignments for sections
 * 7. Updates SchoolConfig academic year to 2026-27
 *
 * Run: node prisma/migrate-2026-27.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// 2026-27 workload data
// sectionPeriods: { sectionName: periodsPerWeek }
// ---------------------------------------------------------------------------

const teacherAssignments = [
  // ===== ENGLISH =====
  { teacher: 'Ms. Anupa Bomjam Fitzpatrick', subject: 'English',
    sectionPeriods: { XIID: 6, XIIE: 6, XIIC: 3, XIIF: 3 } },
  { teacher: 'Ms. Reema Lepcha Chhetri', subject: 'English',
    sectionPeriods: { XIIA: 6, XIB: 6, XID: 6, XA: 6 } },
  { teacher: 'Ms. Srijana Upadhaya', subject: 'English',
    sectionPeriods: { XIIB: 6, XIA: 6, XIE: 6, XB: 6 } },
  { teacher: 'Ms. Deepa Silwal', subject: 'English',
    // XIC+F = 6 shared (3 each), XF = 6, IXB,C = 12 (6 each)
    sectionPeriods: { XIC: 3, XIF: 3, XF: 6, IXB: 6, IXC: 6 } },
  { teacher: 'Ms. Anisha Subba', subject: 'English',
    sectionPeriods: { XC: 6, IXA: 6, VIIIE: 6, VIIIF: 6 } },
  { teacher: 'Mr. Rupesh Thapa', subject: 'English',
    sectionPeriods: { XD: 6, IXD: 6, VIIIA: 6, VIIIB: 6 } },
  { teacher: 'Ms. Samira Ban', subject: 'English',
    sectionPeriods: { XE: 6, IXE: 6, VIIIC: 6, VIIID: 6 } },
  { teacher: 'Ms. Riya Kaushik', subject: 'English',
    sectionPeriods: { IXF: 6, VIIC: 6, VIID: 6, VIIE: 6 } },
  { teacher: 'Mr. Alister Fitzpatrick', subject: 'English',
    sectionPeriods: { VIIA: 6, VIIB: 6, VIB: 6, VIC: 6 } },
  { teacher: 'Ms. Farida Banu Ahmed', subject: 'English',
    sectionPeriods: { VIA: 6, VIE: 6 } },
  { teacher: 'Ms. Rohini Agrawal', subject: 'English',
    sectionPeriods: { VID: 6 } },

  // ===== PHYSICS =====
  { teacher: 'Mr. Surendra Pd. Karnasah', subject: 'Physics',
    sectionPeriods: { XIIA: 11, XIA: 11 } },
  { teacher: 'Mr. Bishnu Datt Badu', subject: 'Physics',
    sectionPeriods: { XIIB: 11, XIB: 11, XA: 4, XB: 4 } },
  { teacher: 'Mr. Buddhi Sagar Dotel', subject: 'Physics',
    sectionPeriods: { XC: 4, XD: 4, IXA: 3, IXB: 3, IXC: 3, VIIIE: 6 } },
  { teacher: 'Mr. Madan Kumar Gautam', subject: 'Physics',
    sectionPeriods: { XE: 4, XF: 4, IXD: 3, IXE: 3, IXF: 3, VIIID: 6 } },

  // ===== CHEMISTRY =====
  { teacher: 'Ms. Sangeeta Khwaounjoo', subject: 'Chemistry',
    sectionPeriods: { XIIB: 12, XIB: 12, XA: 4, XB: 4 } },
  { teacher: 'Mr. Pradip Kumar Rajak', subject: 'Chemistry',
    sectionPeriods: { XIIA: 12, XIA: 12, XC: 4, XD: 4 } },
  { teacher: 'Ms. Rakhi Malik', subject: 'Chemistry',
    sectionPeriods: { VIIIC: 6, VIIC: 6, VIID: 6, VIIE: 6 } },
  { teacher: 'Ms. Prini Sunil Kumar', subject: 'Chemistry',
    sectionPeriods: { VIA: 6 } },
  // Lalita Khadka teaches integrated Science to VII A,B (listed under Chemistry/Science heading)
  { teacher: 'Ms. Lalita Khadka', subject: 'Science',
    sectionPeriods: { VIIA: 6, VIIB: 6 } },

  // ===== BIOLOGY =====
  { teacher: 'Mr. Krishna Kumar Sinha', subject: 'Biology',
    sectionPeriods: { XIIA: 11, XB: 4, XF: 4, IXF: 3 } },
  { teacher: 'Ms. Elhaam Abbas', subject: 'Biology',
    sectionPeriods: { XIA: 11, XC: 4, XE: 4 } },
  { teacher: 'Ms. Elhaam Abbas', subject: 'Chemistry',  // "3-chem" annotation in workload
    sectionPeriods: { IXE: 3, IXF: 3 } },
  { teacher: 'Ms. Neeraj Soni Sharma', subject: 'Biology',
    sectionPeriods: { XA: 4, IXA: 3, IXB: 3, IXC: 3, VIIIA: 6 } },
  { teacher: 'Ms. Purnima Kiran Sharma', subject: 'Biology',
    sectionPeriods: { XD: 4, IXD: 3, IXE: 3, VIIIB: 6, VIIIF: 6 } },
  { teacher: 'Ms. Ranu Roy', subject: 'Biology',
    sectionPeriods: { XE: 4, XF: 4, IXA: 3, IXB: 3, IXC: 3, IXD: 3, VIE: 6 } },

  // ===== MATHEMATICS =====
  { teacher: 'Mr. Awlesh Prasad', subject: 'Mathematics',
    sectionPeriods: { XIIB: 9, IXA: 8, IXB: 8 } },
  { teacher: 'Mr. Anil Kumar Jha', subject: 'Mathematics',
    sectionPeriods: { XB: 9, IXE: 8 } },
  { teacher: 'Mr. Neeraj Kumar Karna', subject: 'Mathematics',
    sectionPeriods: { XIID: 9, XID: 9, XA: 9 } },
  { teacher: 'Mr. Dilip Kumar Mishra', subject: 'Mathematics',
    sectionPeriods: { XE: 9, XF: 9, VIIIA: 8 } },
  { teacher: 'Mr. Rajesh Shrestha', subject: 'Mathematics',
    sectionPeriods: { XIIA: 9, IXF: 8, VIIIB: 8 } },
  { teacher: 'Mr. Deepak Tamang', subject: 'Mathematics',
    sectionPeriods: { XIB: 9, XC: 9, IXD: 8 } },
  { teacher: 'Mr. Kailash Kumar Karna', subject: 'Mathematics',
    sectionPeriods: { XIA: 9, IXC: 8, VIIIC: 8 } },
  { teacher: 'Mr. Satnam Singh', subject: 'Mathematics',
    sectionPeriods: { VIIIE: 8, VIIIF: 8, VIIB: 8 } },
  { teacher: 'Ms. Sasmita Rout', subject: 'Mathematics',
    sectionPeriods: { VIIC: 8, VIID: 8, VIIE: 8 } },
  { teacher: 'Ms. Jigisha Sharma', subject: 'Mathematics',
    sectionPeriods: { XD: 9, VIIID: 8, VIIA: 8 } },
  { teacher: 'Ms. Meera Roka', subject: 'Mathematics',
    sectionPeriods: { VIC: 8, VID: 8 } },
  { teacher: 'Ms. Kavita Shrestha', subject: 'Mathematics',
    sectionPeriods: { VIA: 8, VIB: 8, VIE: 8 } },

  // ===== HINDI =====
  // X level: 2 periods/section/week (grouped), VII-IX: 2-4/week
  { teacher: 'Ms. Usha Sharma', subject: 'Hindi',
    sectionPeriods: { XD: 2, XE: 2, XF: 2, IXA: 2, IXB: 2, IXC: 2, VIIIA: 4, VIIA: 4, VIA: 4 } },
  { teacher: 'Ms. Nisha Jaiswal', subject: 'Hindi',
    sectionPeriods: { XA: 2, XB: 2, XC: 2, VIIA: 2, VIIB: 2, VIIC: 2, VIIIB: 2, VIIIF: 2, VIB: 4 } },
  { teacher: 'Ms. Ritu Sharma', subject: 'Hindi',
    sectionPeriods: { VIIIA: 2, VIIIB: 2, VIIIC: 2, VIIID: 2, VIIIE: 2, VIIIF: 2, VIIID: 4, VIID: 4, VID: 4 } },
  { teacher: 'Ms. Ganga MB Chhetri', subject: 'Hindi',
    sectionPeriods: { VIIID: 2, VIIIE: 2, VIIIF: 2, VIID: 2, VIIE: 2, VIIF: 2, VIIIE: 4, VIIE: 4, VIE: 4 } },
  { teacher: 'Ms. Pooja Rawal', subject: 'Hindi',
    sectionPeriods: { IXA: 2, IXB: 2, IXC: 2, VIA: 2, VIB: 2, VIC: 2, VIIIC: 4, VIIC: 4, VIC: 4 } },

  // ===== NEPALI =====
  { teacher: 'Ms. Parmilla Malla', subject: 'Nepali',
    sectionPeriods: { XB: 5, IXB: 6, VIIIB: 6, VIIB: 6 } },
  { teacher: 'Ms. Deepa Devi Subedi', subject: 'Nepali',
    sectionPeriods: { XC: 5, IXC: 6, VIIIC: 6, VIIC: 6, VIC: 6 } },
  { teacher: 'Mr. Awatar Subedi', subject: 'Nepali',
    sectionPeriods: { XD: 5, IXD: 6, VIIA: 6, VIB: 6, VIIID: 4, VIIIE: 4, VIIIF: 4 } },
  { teacher: 'Ms. Kamala Gnawali', subject: 'Nepali',
    sectionPeriods: { XF: 5, IXF: 6, VIIIF: 6, VIIE: 6 } },
  { teacher: 'Mr. Jit Bahadur Khadka', subject: 'Nepali',
    sectionPeriods: { XA: 5, IXA: 6, VIIIA: 6, VIA: 6, VIID: 4, VIIE: 4 } },
  { teacher: 'Mr. Ajay Gautam', subject: 'Nepali',
    sectionPeriods: { XE: 5, IXE: 6, VIIIE: 6, VIE: 6, VID: 4, VIIE: 4 } },
  { teacher: 'Ms. Amrita Silwal', subject: 'Nepali',
    sectionPeriods: { VIIID: 6, VIID: 6, VID: 6, VIIIA: 4, VIIIB: 4, VIIIC: 4, VIA: 4, VIB: 4, VIC: 4 } },

  // ===== FRENCH =====
  { teacher: 'Ms. Jyoti Shakya', subject: 'French',
    sectionPeriods: { VIIIA: 1, VIIIB: 1, VIIIC: 1, VIIID: 1, VIIA: 1, VIIB: 1, VIIC: 1, VIID: 1, VIA: 1, VIB: 1, VIC: 1, VID: 1 } },

  // ===== COMMERCE — ACCOUNTANCY =====
  { teacher: 'Mr. Raghubir Jha', subject: 'Accountancy',
    sectionPeriods: { XIID: 10, XIE: 10, XIF: 10 } },
  { teacher: 'Ms. Priti Khator', subject: 'Accountancy',
    sectionPeriods: { XIIE: 10, XIIF: 10, XID: 10 } },

  // ===== COMMERCE — BUSINESS STUDIES =====
  { teacher: 'Ms. Pratichha Thapa', subject: 'Business Studies',
    sectionPeriods: { XIIF: 9, XID: 9, XIE: 9 } },
  { teacher: 'Ms. Teeny Chowdhury Das', subject: 'Business Studies',
    sectionPeriods: { XIID: 9, XIIE: 9, XIF: 9 } },

  // ===== ECONOMICS =====
  { teacher: 'Mr. Pankaj Sharma', subject: 'Economics',
    sectionPeriods: { XIID: 9, XID: 9, XIE: 9 } },
  // Binod: XIIE(9), XIB+XIC(9 split), XA-F(12 = 2 each)
  { teacher: 'Mr. Binod Poudel', subject: 'Economics',
    sectionPeriods: { XIIE: 9, XIB: 4, XIC: 5, XA: 2, XB: 2, XC: 2, XD: 2, XE: 2, XF: 2 } },
  // Priyanka: XIIC+F(9 split), XIF(9), IXE(8)
  { teacher: 'Ms. Priyanka Pradhan', subject: 'Economics',
    sectionPeriods: { XIIC: 4, XIIF: 5, XIF: 9, IXE: 8 } },

  // ===== SOCIAL STUDIES =====
  // History
  { teacher: 'Ms. Bibha Lal', subject: 'History',
    sectionPeriods: { XIIC: 9 } },
  // XIC Social Studies
  { teacher: 'Ms. Bibha Lal', subject: 'Social Studies',
    sectionPeriods: { XIC: 9 } },
  // Geography / Psychology
  { teacher: 'Dr. S.S. Baral', subject: 'Geography',
    sectionPeriods: { XIIC: 9 } },
  { teacher: 'Dr. S.S. Baral', subject: 'Social Studies',
    sectionPeriods: { XIC: 9, XA: 2, XB: 2 } },
  // Dilmaya Gurung — Geography for XIC, Social Studies for X C,D,E,F and VIII D,E
  { teacher: 'Ms. Dilmaya Gurung', subject: 'Geography',
    sectionPeriods: { XIC: 9 } },
  { teacher: 'Ms. Dilmaya Gurung', subject: 'Social Studies',
    sectionPeriods: { XC: 4, XD: 4, XE: 4, XF: 4, VIIID: 6, VIIIE: 6 } },
  // Geeta Khanal
  { teacher: 'Ms. Geeta Devi Khanal', subject: 'Social Studies',
    sectionPeriods: { XA: 3, XB: 3, IXA: 8, IXB: 8, IXF: 8 } },
  // Kamala Chand
  { teacher: 'Ms. Kamala Chand', subject: 'Social Studies',
    sectionPeriods: { XC: 3, XD: 3, VIIIB: 6, VIIIC: 6, VIIA: 6 } },
  // Kamlesh Thapa
  { teacher: 'Ms. Kamlesh Thapa Khadka', subject: 'Social Studies',
    sectionPeriods: { XE: 3, XF: 3, IXC: 8, IXD: 8, VIIIA: 6 } },
  // Achyut Raj Sharma
  { teacher: 'Mr. Achyut Raj Sharma', subject: 'Social Studies',
    sectionPeriods: { VIIIF: 6, VIIC: 6, VIID: 6, VIIE: 6, VIE: 6 } },
  // Megha Agrawal — VII B + VI A,B,C,D
  { teacher: 'Ms. Megha Agrawal', subject: 'Social Studies',
    sectionPeriods: { VIIB: 6, VIA: 6, VIB: 6, VIC: 6, VID: 6 } },

  // ===== HOME SCIENCE =====
  { teacher: 'Ms. Lalita Khadka', subject: 'Home Science',
    sectionPeriods: { XIIA: 3, XIIC: 3, XIIF: 3, XIA: 3, XIC: 3, XIF: 3 } },

  // ===== COMPUTER SCIENCE =====
  { teacher: 'Mr. Pradip Kumar Thakur', subject: 'Computer Science',
    sectionPeriods: { XIIB: 9, XIIE: 9, XIIC: 4, XIIF: 5 } },
  { teacher: 'Mr. Bibek Khadka', subject: 'Computer Science',
    sectionPeriods: { XIA: 9, XIE: 9, IXB: 4, IXC: 4, IXD: 4, IXE: 4 } },
  { teacher: 'Ms. Devi Roka Karki', subject: 'Computer Science',
    sectionPeriods: { XIIA: 9, XIC: 4, XIF: 5, VIIIC: 3, VIIID: 3, VIIIE: 3 } },
  { teacher: 'Mr. Raman Khadka', subject: 'Computer Science',
    sectionPeriods: { XIB: 9, XA: 3, XB: 3, XC: 3, XD: 3, XE: 3, XF: 3, IXA: 4 } },
  { teacher: 'Mr. Santosh Nepal', subject: 'Computer Science',
    sectionPeriods: { IXF: 4, VIIIA: 3, VIIIB: 3, VIIIF: 3, VIIA: 3, VIIB: 3, VIIC: 3, VIID: 3, VIIE: 3 } },

  // ===== INFORMATICS PRACTICES (IP) =====
  // Ponmani handles VI A-E and V A-E (junior computer lab)
  { teacher: 'Ms. Ponmani A', subject: 'Computer Science',
    sectionPeriods: { VIA: 3, VIB: 3, VIC: 3, VID: 3, VIE: 3 } },

  // ===== YOGA =====
  { teacher: 'Ms. Shraddha Timalsena', subject: 'Yoga',
    sectionPeriods: { VIA: 2, VIB: 2, VIC: 2, VID: 2, VIE: 2,
                      VIIA: 2, VIIB: 2, VIIC: 2, VIID: 2, VIIE: 2,
                      VIIIA: 2, VIIIB: 2, VIIIC: 2, VIIID: 2, VIIIE: 2, VIIIF: 2 } },

  // ===== GAMES / SPORTS =====
  { teacher: 'Mr. Dev Raj Anand', subject: 'Games',
    sectionPeriods: { VIIA: 3, VIIB: 3, VIIC: 3, VIID: 3, VIIE: 3, VIIF: 3 } },
  { teacher: 'Mr. Bijaya Kumar Khatri', subject: 'Games',
    sectionPeriods: { VIIIA: 3, VIIIB: 3, VIIIC: 3, VIIID: 3, VIIIE: 3, VIIIF: 3 } },
  { teacher: 'Mr. Naresh Rawal', subject: 'Games',
    sectionPeriods: { IXA: 3, IXB: 3, IXC: 3, IXD: 3, IXE: 3, IXF: 3 } },
  { teacher: 'Mr. Dipris Muni Bajrachara', subject: 'Games',
    sectionPeriods: { XA: 3, XB: 3, XC: 3, XD: 3, XE: 3, XF: 3 } },
  { teacher: 'Mr. Prashant Maharjan', subject: 'Games',
    sectionPeriods: { XIA: 3, XIB: 3, XIC: 3, XID: 3, XIE: 3, XIF: 3 } },
  { teacher: 'Mr. Abishek Basnet', subject: 'Games',
    sectionPeriods: { XIIA: 3, XIIB: 3, XIIC: 3, XIID: 3, XIIE: 3, XIIF: 3 } },

  // ===== LIBRARY =====
  { teacher: 'Ms. Poonam Mishra', subject: 'Library',
    sectionPeriods: { XIIA: 1, XIIB: 1, XIIC: 1, XIID: 1, XIIE: 1, XIIF: 1,
                      XIA: 1, XIB: 1, XIC: 1, XID: 1, XIE: 1, XIF: 1 } },
  { teacher: 'Mr. Om Prakash Shah', subject: 'Library',
    sectionPeriods: { XA: 1, XB: 1, XC: 1, XD: 1, XE: 1, XF: 1,
                      IXA: 1, IXB: 1, IXC: 1, IXD: 1, IXE: 1, IXF: 1,
                      VIIIA: 1, VIIIB: 1, VIIIC: 1, VIIID: 1, VIIIE: 1, VIIIF: 1,
                      VIIA: 1, VIIB: 1, VIIC: 1, VIID: 1, VIIE: 1, VIIF: 1,
                      VIA: 1, VIB: 1, VIC: 1, VID: 1, VIE: 1 } },

  // ===== ART =====
  { teacher: 'Mr. Raja Man Karmacharya', subject: 'Art',
    sectionPeriods: { VIIA: 1, VIIB: 1, VIIC: 1, VIID: 1, VIIE: 1, VIIF: 1,
                      VIIIA: 1, VIIIB: 1, VIIIC: 1, VIIID: 1, VIIIE: 1, VIIIF: 1,
                      IXA: 1, IXB: 1, IXC: 1, IXD: 1, IXE: 1, IXF: 1,
                      XA: 1, XB: 1, XC: 1, XD: 1, XE: 1, XF: 1 } },
  { teacher: 'Mr. Manoj Shakya Panju', subject: 'Art',
    sectionPeriods: { VIA: 2, VIB: 2, VIC: 2, VID: 2, VIE: 2,
                      VIIA: 2, VIIB: 2, VIIC: 2, VIIIA: 2, VIIIB: 2, VIIIC: 2 } },

  // ===== MUSIC =====
  { teacher: 'Ms. Sangeeta Pradhan Rana', subject: 'Music',
    sectionPeriods: { VIA: 2, VIB: 2, VIC: 2, VID: 2, VIE: 2,
                      VIIA: 2, VIIB: 2, VIIC: 2, VIID: 2, VIIE: 2, VIIF: 2,
                      VIIIA: 2, VIIIB: 2, VIIIC: 2, VIIID: 2, VIIIE: 2, VIIIF: 2,
                      IXA: 1, IXB: 1, IXC: 1, IXD: 1, IXE: 1, IXF: 1 } },

  // ===== INNOVATION =====
  { teacher: 'Ms. Anupa Bomjam Fitzpatrick', subject: 'Innovation',
    sectionPeriods: { XIIC: 1, XIIF: 1 } },
  { teacher: 'Mr. Alister Fitzpatrick', subject: 'Innovation',
    sectionPeriods: { VIB: 1 } },
  { teacher: 'Ms. Rohini Agrawal', subject: 'Innovation',
    sectionPeriods: { VID: 1 } },
  { teacher: 'Mr. Surendra Pd. Karnasah', subject: 'Innovation',
    sectionPeriods: { XIA: 2, XIIA: 2 } },
  { teacher: 'Mr. Buddhi Sagar Dotel', subject: 'Innovation',
    sectionPeriods: { VIIIE: 1, XC: 1, XD: 1 } },
  { teacher: 'Mr. Madan Kumar Gautam', subject: 'Innovation',
    sectionPeriods: { VIIID: 1, XE: 1, XF: 1 } },
  { teacher: 'Ms. Rakhi Malik', subject: 'Innovation',
    sectionPeriods: { VIID: 2, VIIE: 2 } },
  { teacher: 'Mr. Neeraj Kumar Karna', subject: 'Innovation',
    sectionPeriods: { XA: 1, XID: 1, XIID: 1 } },
  { teacher: 'Mr. Dilip Kumar Mishra', subject: 'Innovation',
    sectionPeriods: { XF: 1 } },
  { teacher: 'Mr. Rajesh Shrestha', subject: 'Innovation',
    sectionPeriods: { IXF: 1, VIIIB: 1 } },
  { teacher: 'Mr. Deepak Tamang', subject: 'Innovation',
    sectionPeriods: { XC: 1 } },
  { teacher: 'Mr. Kailash Kumar Karna', subject: 'Innovation',
    sectionPeriods: { IXC: 1, VIIIC: 1 } },
  { teacher: 'Mr. Satnam Singh', subject: 'Innovation',
    sectionPeriods: { VIIIE: 1, VIIIF: 1 } },
  { teacher: 'Ms. Sasmita Rout', subject: 'Innovation',
    sectionPeriods: { VIIC: 1, VIID: 1 } },
  { teacher: 'Ms. Jigisha Sharma', subject: 'Innovation',
    sectionPeriods: { VIIA: 2, XD: 2 } },
  { teacher: 'Mr. Pankaj Sharma', subject: 'Innovation',
    sectionPeriods: { XIID: 1 } },
  { teacher: 'Ms. Priyanka Pradhan', subject: 'Innovation',
    sectionPeriods: { XIF: 1 } },
  { teacher: 'Ms. Pratichha Thapa', subject: 'Innovation',
    sectionPeriods: { XIE: 1, XIIF: 1 } },
  { teacher: 'Mr. Krishna Kumar Sinha', subject: 'Innovation',
    sectionPeriods: { XIIA: 2, IXF: 2 } },
  { teacher: 'Ms. Elhaam Abbas', subject: 'Innovation',
    sectionPeriods: { XIA: 3, XE: 2 } },
  { teacher: 'Ms. Neeraj Soni Sharma', subject: 'Innovation',
    sectionPeriods: { IXB: 3, VIIIA: 4 } },
  { teacher: 'Ms. Purnima Kiran Sharma', subject: 'Innovation',
    sectionPeriods: { XD: 3, VIIIB: 3, VIIIF: 3 } },
  { teacher: 'Mr. Santosh Nepal', subject: 'Innovation',
    sectionPeriods: { VIIIE: 1 } },
];

// ---------------------------------------------------------------------------
// Class Teacher assignments (from workload CT annotations)
// ---------------------------------------------------------------------------
const classTeacherMap = {
  // Section: teacher name
  XID:  'Ms. Reema Lepcha Chhetri',
  VIIIF: 'Ms. Anisha Subba',
  IXD:  'Mr. Rupesh Thapa',
  IXE:  'Ms. Samira Ban',
  VIIE: 'Ms. Riya Kaushik',
  VIB:  'Mr. Alister Fitzpatrick',
  VID:  'Ms. Rohini Agrawal',
  XIIA: 'Mr. Surendra Pd. Karnasah',
  XIA:  'Mr. Bishnu Datt Badu', // listed as CT-XIA for Bishnu
  VIIIE: 'Mr. Buddhi Sagar Dotel',
  VIIID: 'Mr. Madan Kumar Gautam',
  XIIB: 'Ms. Sangeeta Khwaounjoo',
  // XIA also CT for Pradip - note: XIA CT will be set to Bishnu (Physics HOD assigned there)
  // Conflict: both Bishnu (Physics) and Pradip (Chemistry) listed as CT-XIA — Bishnu takes precedence
  VIID: 'Ms. Rakhi Malik',
  XIIC: 'Ms. Lalita Khadka',
  XA:   'Mr. Neeraj Kumar Karna',
  XF:   'Mr. Dilip Kumar Mishra',
  IXF:  'Mr. Rajesh Shrestha',
  XC:   'Mr. Deepak Tamang',
  IXC:  'Mr. Kailash Kumar Karna',
  VIIC: 'Ms. Sasmita Rout',
  VIIA: 'Ms. Jigisha Sharma',
  VIC:  'Ms. Meera Roka',
  VIA:  'Ms. Kavita Shrestha',
  VIIB: 'Ms. Megha Agrawal',
  XIID: 'Mr. Pankaj Sharma',
  XIIE: 'Mr. Binod Poudel',
  XIF:  'Ms. Priyanka Pradhan',
  XIIF: 'Ms. Priti Khator',
  XIE:  'Ms. Pratichha Thapa',
  XIC:  'Ms. Dilmaya Gurung',
  XB:   'Ms. Geeta Devi Khanal',
  VIIIF: 'Ms. Kamlesh Thapa Khadka', // conflict with VIIIF=Anisha above; Anisha=VIIIF, Kamlesh=VIIIF — will use Kamlesh
  VIIIC: 'Ms. Devi Roka Karki',
  IXA:  'Mr. Raman Khadka',
  VIIIE: 'Mr. Santosh Nepal',
  VID2: 'Ms. Ponmani A', // CT-VID (listed for Ponmani but VID already has Rohini — use Ponmani)
  IXB:  'Ms. Neeraj Soni Sharma',
  XD:   'Ms. Purnima Kiran Sharma',
  XE:   'Ms. Elhaam Abbas',
};

// ---------------------------------------------------------------------------
// Workload targets for 2026-27
// ---------------------------------------------------------------------------
const workloadTargets = {
  'Ms. Anupa Bomjam Fitzpatrick': 18,
  'Ms. Reema Lepcha Chhetri':     24,
  'Ms. Srijana Upadhaya':         24,
  'Ms. Deepa Silwal':             24,
  'Ms. Anisha Subba':             24,
  'Mr. Rupesh Thapa':             24,
  'Ms. Samira Ban':               24,
  'Ms. Riya Kaushik':             24,
  'Mr. Alister Fitzpatrick':      24,
  'Ms. Farida Banu Ahmed':        12,
  'Ms. Rohini Agrawal':           6,
  'Ms. Prini Sunil Kumar':        6,
  'Mr. Surendra Pd. Karnasah':    22,
  'Mr. Bishnu Datt Badu':         30,
  'Mr. Buddhi Sagar Dotel':       23,
  'Mr. Madan Kumar Gautam':       23,
  'Ms. Rakhi Malik':              24,
  'Ms. Sangeeta Khwaounjoo':      32,
  'Mr. Pradip Kumar Rajak':       32,
  'Mr. Krishna Kumar Sinha':      22,
  'Ms. Elhaam Abbas':             25,
  'Ms. Neeraj Soni Sharma':       19,
  'Ms. Purnima Kiran Sharma':     22,
  'Ms. Ranu Roy':                 26,
  'Ms. Deepa Dutta':              30,
  'Mr. Awlesh Prasad':            25,
  'Mr. Anil Kumar Jha':           17,
  'Mr. Neeraj Kumar Karna':       27,
  'Mr. Dilip Kumar Mishra':       26,
  'Mr. Rajesh Shrestha':          25,
  'Mr. Deepak Tamang':            26,
  'Mr. Kailash Kumar Karna':      25,
  'Mr. Satnam Singh':             24,
  'Ms. Sasmita Rout':             24,
  'Ms. Jigisha Sharma':           25,
  'Ms. Meera Roka':               16,
  'Ms. Kavita Shrestha':          24,
  'Ms. Megha Agrawal':            30,
  'Ms. Usha Sharma':              24,
  'Ms. Nisha Jaiswal':            24,
  'Ms. Ritu Sharma':              24,
  'Ms. Ganga MB Chhetri':         24,
  'Ms. Pooja Rawal':              24,
  'Ms. Parmilla Malla':           23,
  'Ms. Deepa Devi Subedi':        29,
  'Mr. Awatar Subedi':            27,
  'Ms. Kamala Gnawali':           23,
  'Mr. Jit Bahadur Khadka':       27,
  'Mr. Ajay Gautam':              27,
  'Ms. Amrita Silwal':            30,
  'Ms. Jyoti Shakya':             15,
  'Mr. Raghubir Jha':             30,
  'Ms. Priti Khator':             30,
  'Ms. Pratichha Thapa':          27,
  'Ms. Teeny Chowdhury Das':      27,
  'Mr. Pankaj Sharma':            27,
  'Mr. Binod Poudel':             30,
  'Ms. Priyanka Pradhan':         26,
  'Ms. Bibha Lal':                18,
  'Dr. S.S. Baral':               22,
  'Ms. Dilmaya Gurung':           29,
  'Ms. Geeta Devi Khanal':        30,
  'Ms. Kamala Chand':             24,
  'Ms. Kamlesh Thapa Khadka':     28,
  'Mr. Achyut Raj Sharma':        30,
  'Ms. Lalita Khadka':            30,
  'Mr. Pradip Kumar Thakur':      27,
  'Mr. Bibek Khadka':             34,
  'Ms. Devi Roka Karki':          27,
  'Mr. Raman Khadka':             31,
  'Mr. Santosh Nepal':            28,
  'Ms. Ponmani A':                30,
  'Ms. Shraddha Timalsena':       32,
  'Mr. Dev Raj Anand':            36,
  'Mr. Bijaya Kumar Khatri':      36,
  'Mr. Naresh Rawal':             36,
  'Mr. Dipris Muni Bajrachara':   36,
  'Mr. Prashant Maharjan':        36,
  'Mr. Abishek Basnet':           36,
  'Ms. Poonam Mishra':            42,
  'Mr. Om Prakash Shah':          42,
  'Mr. Raja Man Karmacharya':     23,
  'Mr. Manoj Shakya Panju':       30,
  'Ms. Sangeeta Pradhan Rana':    36,
};

// Rakhi Malik department change: Physics → Chemistry
const departmentChanges = {
  'Ms. Rakhi Malik': 'Chemistry',
};

// ---------------------------------------------------------------------------
async function main() {
  console.log('=== 2026-27 Migration Starting ===\n');

  // --- Load lookup maps ---
  const grades    = await prisma.grade.findMany();
  const sections  = await prisma.section.findMany();
  const subjects  = await prisma.subject.findMany();
  const teachers  = await prisma.teacher.findMany();

  const gradeMap   = Object.fromEntries(grades.map(g => [g.name, g]));
  const sectionMap = Object.fromEntries(sections.map(s => [s.name, s]));
  const subjectMap = Object.fromEntries(subjects.map(s => [s.name, s]));
  const teacherMap = Object.fromEntries(teachers.map(t => [t.name, t]));

  // --- 1. Ensure XF section exists ---
  if (!sectionMap['XF']) {
    const xGrade = gradeMap['X'];
    if (!xGrade) throw new Error('Grade X not found in DB');
    const xfSection = await prisma.section.create({
      data: { name: 'XF', gradeId: xGrade.id, stream: null }
    });
    sectionMap['XF'] = xfSection;
    console.log('✓ Created section XF');
  } else {
    console.log('  Section XF already exists');
  }

  // --- 2. Add new teachers ---
  let alister = teacherMap['Mr. Alister Fitzpatrick'];
  if (!alister) {
    alister = await prisma.teacher.create({
      data: {
        name: 'Mr. Alister Fitzpatrick',
        abbreviation: 'AF',
        department: 'English',
        isHOD: false,
        targetWorkload: 24,
        isActive: true,
        teachableGrades: JSON.stringify(['VI', 'VII']),
      }
    });
    teacherMap['Mr. Alister Fitzpatrick'] = alister;
    console.log('✓ Created teacher: Mr. Alister Fitzpatrick (English)');
  } else {
    console.log('  Mr. Alister Fitzpatrick already exists');
  }

  let dipris = teacherMap['Mr. Dipris Muni Bajrachara'];
  if (!dipris) {
    dipris = await prisma.teacher.create({
      data: {
        name: 'Mr. Dipris Muni Bajrachara',
        abbreviation: 'DMB',
        department: 'Sports',
        isHOD: false,
        targetWorkload: 36,
        isActive: true,
        teachableGrades: JSON.stringify(['X']),
      }
    });
    teacherMap['Mr. Dipris Muni Bajrachara'] = dipris;
    console.log('✓ Created teacher: Mr. Dipris Muni Bajrachara (Sports)');
  } else {
    console.log('  Mr. Dipris Muni Bajrachara already exists');
  }

  // Refresh teacher map after creates
  const allTeachers = await prisma.teacher.findMany();
  const tMap = Object.fromEntries(allTeachers.map(t => [t.name, t]));

  // --- 3. Department changes ---
  for (const [name, dept] of Object.entries(departmentChanges)) {
    const t = tMap[name];
    if (t && t.department !== dept) {
      await prisma.teacher.update({ where: { id: t.id }, data: { department: dept } });
      console.log(`✓ Updated ${name} department → ${dept}`);
    }
  }

  // --- 4. Update targetWorkload for all teachers ---
  let workloadUpdates = 0;
  for (const [name, workload] of Object.entries(workloadTargets)) {
    const t = tMap[name];
    if (!t) {
      console.warn(`  ⚠ Teacher not found for workload update: ${name}`);
      continue;
    }
    if (t.targetWorkload !== workload) {
      await prisma.teacher.update({ where: { id: t.id }, data: { targetWorkload: workload } });
      workloadUpdates++;
    }
  }
  console.log(`✓ Updated workloads for ${workloadUpdates} teachers`);

  // --- 5. Clear existing TeacherSubject records ---
  const deleted = await prisma.teacherSubject.deleteMany({});
  console.log(`✓ Cleared ${deleted.count} existing TeacherSubject records`);

  // --- 6. Rebuild TeacherSubject from 2026-27 data ---
  let created = 0;
  let skipped = 0;
  const errors = [];

  // Refresh section map (includes new XF)
  const allSections = await prisma.section.findMany();
  const sMap = Object.fromEntries(allSections.map(s => [s.name, s]));
  const subMap = Object.fromEntries(subjects.map(s => [s.name, s]));

  for (const assignment of teacherAssignments) {
    const teacher = tMap[assignment.teacher];
    if (!teacher) {
      errors.push(`Teacher not found: ${assignment.teacher}`);
      continue;
    }
    const subject = subMap[assignment.subject];
    if (!subject) {
      errors.push(`Subject not found: ${assignment.subject} (for ${assignment.teacher})`);
      continue;
    }

    for (const [sectionName, periods] of Object.entries(assignment.sectionPeriods)) {
      const section = sMap[sectionName];
      if (!section) {
        errors.push(`Section not found: ${sectionName} (${assignment.teacher} / ${assignment.subject})`);
        skipped++;
        continue;
      }
      if (periods <= 0) { skipped++; continue; }

      try {
        await prisma.teacherSubject.upsert({
          where: { teacherId_subjectId_sectionId: {
            teacherId: teacher.id,
            subjectId: subject.id,
            sectionId: section.id,
          }},
          update: { periodsPerWeek: periods },
          create: {
            teacherId: teacher.id,
            subjectId: subject.id,
            sectionId: section.id,
            periodsPerWeek: periods,
            isLabAssignment: false,
          }
        });
        created++;
      } catch (e) {
        errors.push(`Error creating ${assignment.teacher}/${assignment.subject}/${sectionName}: ${e.message}`);
      }
    }
  }
  console.log(`✓ Created ${created} TeacherSubject records (${skipped} skipped)`);

  // --- 7. Update class teacher assignments ---
  let ctUpdates = 0;
  for (const [sectionName, teacherName] of Object.entries(classTeacherMap)) {
    const section = sMap[sectionName];
    const teacher = tMap[teacherName];
    if (!section || !teacher) continue;
    await prisma.section.update({
      where: { id: section.id },
      data: { classTeacherId: teacher.id }
    });
    ctUpdates++;
  }
  console.log(`✓ Updated class teacher assignments for ${ctUpdates} sections`);

  // --- 8. Update SchoolConfig ---
  await prisma.schoolConfig.updateMany({
    data: { academicYear: '2026-27' }
  });
  console.log('✓ Updated academic year → 2026-27');

  // --- Summary ---
  console.log('\n=== Migration Complete ===');
  if (errors.length > 0) {
    console.log(`\n⚠ ${errors.length} warnings/errors:`);
    errors.forEach(e => console.log('  -', e));
  }
}

main()
  .catch(e => { console.error('Migration failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
