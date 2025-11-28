
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useState, useEffect } from 'react';
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import { Globe, Database, Code, Layout, Terminal, Menu, X, Calendar, ChevronLeft, ChevronRight, Mail, Linkedin, Phone, BookOpen, Award, FileText } from 'lucide-react';
import FluidBackground from './components/FluidBackground';
import GradientText from './components/GlitchText';
import CustomCursor from './components/CustomCursor';
import ArtistCard from './components/ArtistCard';
import AIChat from './components/AIChat';
import { Project } from './types';

// Portfolio Data for Yash Solanki based on Resume
const PROJECTS: Project[] = [
  { 
    id: '1', 
    name: 'Avian Influenza Dashboard', 
    category: 'React / Node / PostgreSQL', 
    year: '2025', 
    image: 'https://images.unsplash.com/photo-1576086213369-97a306d36557?q=80&w=1000&auto=format&fit=crop',
    description: 'Built a web application using React+Node/Express with PostgreSQL to analyze and visualize 10,000+ genomic datasets. Integrated Node backend with large-scale data visualization tools and used advanced React components for data representation.'
  },
  { 
    id: '2', 
    name: 'VNTRseeker', 
    category: 'Node / HTML / CSS', 
    year: '2023', 
    image: 'https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?q=80&w=1000&auto=format&fit=crop',
    description: 'Developed a web application for bulk-sequence data processing. Implemented backend logic to improve pipeline efficiency by 25%. Presented at the Asian Citrus Congress 2023.'
  },
  { 
    id: '3', 
    name: 'Data Analysis Suite', 
    category: 'Python / Pandas / Power BI', 
    year: '2024', 
    image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=1000&auto=format&fit=crop',
    description: 'Comprehensive data analysis projects utilizing Excel, Power BI, Pandas, NumPy, Matplotlib, and Seaborn for extracting insights from complex datasets.'
  }
];

const App: React.FC = () => {
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], [0, -100]);
  const opacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  
  // Handle keyboard navigation for project modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedProject) return;
      if (e.key === 'ArrowLeft') navigateProject('prev');
      if (e.key === 'ArrowRight') navigateProject('next');
      if (e.key === 'Escape') setSelectedProject(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedProject]);


  const scrollToSection = (id: string) => {
    setMobileMenuOpen(false);
    const element = document.getElementById(id);
    if (element) {
      const headerOffset = 100;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.scrollY - headerOffset;

      window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
      });
    }
  };

  const navigateProject = (direction: 'next' | 'prev') => {
    if (!selectedProject) return;
    const currentIndex = PROJECTS.findIndex(p => p.id === selectedProject.id);
    let nextIndex;
    if (direction === 'next') {
      nextIndex = (currentIndex + 1) % PROJECTS.length;
    } else {
      nextIndex = (currentIndex - 1 + PROJECTS.length) % PROJECTS.length;
    }
    setSelectedProject(PROJECTS[nextIndex]);
  };
  
  return (
    <div className="relative min-h-screen text-zinc-200 selection:bg-white selection:text-black cursor-auto md:cursor-none overflow-x-hidden">
      <CustomCursor />
      <FluidBackground />
      <AIChat />
      
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-6 md:px-8 py-6 mix-blend-difference">
        <div className="font-heading text-xl md:text-2xl font-bold tracking-tighter text-white cursor-default z-50">YASH.DEV</div>
        
        {/* Desktop Menu */}
        <div className="hidden md:flex gap-10 text-sm font-bold tracking-widest uppercase text-zinc-400">
          {['Work', 'About', 'Education'].map((item) => (
            <button 
              key={item} 
              onClick={() => scrollToSection(item.toLowerCase())}
              className="hover:text-white transition-colors cursor-pointer bg-transparent border-none"
              data-hover="true"
            >
              {item}
            </button>
          ))}
        </div>
        <button 
          onClick={() => scrollToSection('contact')}
          className="hidden md:inline-block border border-zinc-500 px-8 py-3 text-xs font-bold tracking-widest uppercase hover:bg-white hover:text-black transition-all duration-300 text-white cursor-pointer bg-transparent"
          data-hover="true"
        >
          Contact
        </button>

        {/* Mobile Menu Toggle */}
        <button 
          className="md:hidden text-white z-50 relative w-10 h-10 flex items-center justify-center"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
           {mobileMenuOpen ? <X /> : <Menu />}
        </button>
      </nav>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed inset-0 z-30 bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center gap-8 md:hidden"
          >
            {['Work', 'About', 'Education'].map((item) => (
              <button
                key={item}
                onClick={() => scrollToSection(item.toLowerCase())}
                className="text-4xl font-heading font-bold text-white hover:text-zinc-400 transition-colors uppercase bg-transparent border-none"
              >
                {item}
              </button>
            ))}
            <button 
              onClick={() => scrollToSection('contact')}
              className="mt-8 border border-white px-10 py-4 text-sm font-bold tracking-widest uppercase bg-white text-black"
            >
              Contact
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HERO SECTION */}
      <header className="relative h-[100svh] min-h-[600px] flex flex-col items-center justify-center overflow-hidden px-4">
        <motion.div 
          style={{ y, opacity }}
          className="z-10 text-center flex flex-col items-center w-full max-w-6xl pb-24 md:pb-20"
        >
           {/* Role / Location */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.2 }}
            className="flex flex-col md:flex-row items-center gap-3 md:gap-6 text-xs md:text-sm font-mono text-zinc-400 tracking-[0.2em] md:tracking-[0.3em] uppercase mb-6"
          >
            <span className="bg-white/5 px-4 py-2 rounded-full border border-white/5">Ahmedabad, India</span>
            <span className="hidden md:inline text-zinc-600">—</span>
            <span className="bg-white/5 px-4 py-2 rounded-full border border-white/5 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"/>
              Available for hire
            </span>
          </motion.div>

          {/* Main Title */}
          <div className="relative w-full flex justify-center items-center">
            <GradientText 
              text="YASH" 
              as="h1" 
              className="text-[20vw] md:text-[15vw] leading-[0.9] font-black tracking-tighter text-center" 
            />
            {/* Optimized Orb */}
            <motion.div 
               className="absolute -z-20 w-[40vw] h-[40vw] bg-white/5 blur-[80px] rounded-full pointer-events-none"
               animate={{ opacity: [0.1, 0.2, 0.1] }}
               transition={{ duration: 6, repeat: Infinity }}
            />
          </div>
          <div className="relative w-full flex justify-center items-center -mt-4 md:-mt-10">
            <GradientText 
              text="SOLANKI" 
              as="h1" 
              className="text-[12vw] md:text-[8vw] leading-[0.9] font-black tracking-tighter text-center text-zinc-500" 
            />
          </div>
          
          <motion.div
             initial={{ scaleX: 0 }}
             animate={{ scaleX: 1 }}
             transition={{ duration: 1.5, delay: 0.5, ease: "circOut" }}
             className="w-24 md:w-40 h-1 bg-white mt-8 md:mt-12 mb-6 md:mb-8"
          />

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 1 }}
            className="text-lg md:text-xl font-light max-w-xl mx-auto text-zinc-300 tracking-wide uppercase"
          >
            Full Stack Developer & Data Analyst
          </motion.p>
        </motion.div>

        {/* MARQUEE */}
        <div className="absolute bottom-12 md:bottom-16 left-0 w-full py-4 md:py-6 bg-zinc-900 border-y border-white/10 text-zinc-400 z-20 overflow-hidden">
          <motion.div 
            className="flex w-fit will-change-transform"
            animate={{ x: "-50%" }}
            transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
          >
            {[0, 1].map((key) => (
              <div key={key} className="flex whitespace-nowrap shrink-0">
                {[...Array(4)].map((_, i) => (
                  <span key={i} className="text-xl md:text-3xl font-heading font-bold px-8 flex items-center gap-6">
                    MERN STACK <span className="text-zinc-700">●</span> 
                    PYTHON <span className="text-zinc-700">●</span> 
                    DATA ANALYSIS <span className="text-zinc-700">●</span> 
                    REACT <span className="text-zinc-700">●</span> 
                    SQL <span className="text-white text-lg md:text-2xl">✦</span>
                  </span>
                ))}
              </div>
            ))}
          </motion.div>
        </div>
      </header>

      {/* PROJECTS SECTION */}
      <section id="work" className="relative z-10 py-20 md:py-32">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6">
          <div className="flex flex-col md:flex-row justify-between items-end mb-12 md:mb-16 px-4">
             <h2 className="text-5xl md:text-8xl font-heading font-bold uppercase leading-[0.9] text-white">
              Selected <br/> 
              <span className="text-zinc-600">Works</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 border-t border-l border-white/10">
            {PROJECTS.map((project) => (
              <ArtistCard key={project.id} project={project} onClick={() => setSelectedProject(project)} />
            ))}
          </div>
        </div>
      </section>

      {/* ABOUT SECTION */}
      <section id="about" className="relative z-10 py-20 md:py-32 bg-zinc-900/30 border-t border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 md:px-6 relative">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 md:gap-16 items-start">
            <div className="lg:col-span-5 order-2 lg:order-1">
              <h2 className="text-3xl md:text-5xl font-heading font-bold mb-6 md:mb-8 text-white">
                Professional <br/> <span className="text-zinc-500">Overview</span>
              </h2>
              <p className="text-lg md:text-xl text-zinc-300 mb-8 md:mb-12 font-light leading-relaxed">
                Passionate MERN-full stack Developer fresher with hands-on experience in web applications, data pipelines, and automation projects. Skilled in applying Python and Javascript for both backend development and large-scale data extraction. Strong analytical background from academic projects, eager to contribute in a fast-paced development environment.
              </p>
              
              <div className="space-y-6">
                 <div>
                   <h3 className="text-sm font-bold uppercase tracking-widest text-white mb-3">Python Libraries</h3>
                   <p className="text-zinc-400 text-sm leading-relaxed">Selenium, Django+Flask, Scrapy, Automation, Scipy, scikit-learn, Pytorch</p>
                 </div>
                 <div>
                   <h3 className="text-sm font-bold uppercase tracking-widest text-white mb-3">Database</h3>
                   <p className="text-zinc-400 text-sm leading-relaxed">SQL, PostgreSQL, MongoDB</p>
                 </div>
                 <div>
                   <h3 className="text-sm font-bold uppercase tracking-widest text-white mb-3">Web Development</h3>
                   <p className="text-zinc-400 text-sm leading-relaxed">Python, JavaScript, HTML, CSS, Django, Flask, React</p>
                 </div>
                 <div>
                   <h3 className="text-sm font-bold uppercase tracking-widest text-white mb-3">Data Analysis</h3>
                   <p className="text-zinc-400 text-sm leading-relaxed">Excel, Power BI, Pandas, NumPy, Matplotlib, Seaborn</p>
                 </div>
              </div>
            </div>

            <div className="lg:col-span-7 w-full order-1 lg:order-2 space-y-8">
               <h3 className="text-2xl font-heading font-bold text-white mb-6 border-b border-white/10 pb-4">Certifications</h3>
               
               {[
                 { title: "GenAI Powered Data Analytics Job Simulation", org: "Forage" },
                 { title: "Deloitte Australia Data Analytics Job Simulation", org: "Deloitte" },
                 { title: "Introduction to Data Science Job Simulation", org: "Commonwealth Bank" }
               ].map((cert, i) => (
                 <div key={i} className="group relative p-6 bg-white/5 hover:bg-white/10 transition-colors border-l-2 border-zinc-700 hover:border-white">
                    <Award className="w-8 h-8 text-white mb-4 opacity-50 group-hover:opacity-100 transition-opacity" />
                    <h4 className="text-xl font-bold text-white mb-1">{cert.title}</h4>
                    <p className="text-sm text-zinc-400 uppercase tracking-wider">{cert.org}</p>
                 </div>
               ))}
            </div>
          </div>
        </div>
      </section>

      {/* EDUCATION SECTION (Formerly Services) */}
      <section id="education" className="relative z-10 py-20 md:py-32 px-4 md:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12 md:mb-20">
             <h2 className="text-5xl md:text-9xl font-heading font-bold text-white/5 absolute left-0 right-0 -mt-10 select-none pointer-events-none">
               LEARNING
             </h2>
             <h2 className="text-4xl md:text-6xl font-heading font-bold text-white relative z-10">
               EDUCATION
             </h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { degree: 'MSc Biotechnology', uni: 'Gujarat Biotechnology University', year: '2023 - 2025', score: '7.5 CGPA' },
              { degree: 'PG Diploma Bioinformatics', uni: 'Gujarat Technological University', year: '2022 - 2023', score: '9 CGPA' },
              { degree: 'BSc Microbiology', uni: 'CU Shah Institute of Science', year: '2019 - 2022', score: '6.78 CGPA' },
            ].map((item, i) => (
                <motion.div
                  key={i}
                  whileHover={{ y: -10 }}
                  className="relative p-8 border border-white/10 bg-zinc-900/50 backdrop-blur-sm flex flex-col justify-between min-h-[300px]"
                >
                  <div>
                    <BookOpen className="w-6 h-6 text-zinc-500 mb-6" />
                    <div className="text-sm font-mono text-zinc-500 mb-2">{item.year}</div>
                    <h3 className="text-2xl font-bold text-white mb-2 leading-tight">{item.degree}</h3>
                    <p className="text-zinc-400">{item.uni}</p>
                  </div>
                  
                  <div className="mt-8 pt-6 border-t border-white/5">
                    <div className="text-xs uppercase tracking-widest text-zinc-500 mb-1">Performance</div>
                    <div className="text-3xl font-bold text-white">{item.score}</div>
                  </div>
                </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CONTACT & FOOTER */}
      <footer id="contact" className="relative z-10 border-t border-white/10 py-20 bg-black">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 mb-20">
             <div>
               <h2 className="text-4xl md:text-6xl font-heading font-bold text-white mb-8">Let's Connect</h2>
               <p className="text-zinc-400 text-lg mb-8 max-w-md">
                 Open to opportunities in Full Stack Development, Data Analysis, and Automation.
               </p>
               <div className="space-y-4">
                 <a href="mailto:yashsolanki466@gmail.com" className="flex items-center gap-4 text-white hover:text-zinc-400 transition-colors">
                   <Mail className="w-5 h-5" /> yashsolanki466@gmail.com
                 </a>
                 <a href="tel:9601793485" className="flex items-center gap-4 text-white hover:text-zinc-400 transition-colors">
                   <Phone className="w-5 h-5" /> +91 9601793485
                 </a>
                 <div className="flex items-center gap-4 text-zinc-400">
                   <Globe className="w-5 h-5" /> Ahmedabad, Gujarat, India
                 </div>
               </div>
             </div>
             
             <div className="flex flex-col justify-end items-start md:items-end">
                <a 
                  href="https://linkedin.com" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="group flex items-center gap-4 text-2xl font-bold text-white hover:text-zinc-400 transition-colors mb-4"
                >
                  LinkedIn <ArrowUpRight className="w-6 h-6 group-hover:-translate-y-1 group-hover:translate-x-1 transition-transform" />
                </a>
                <a 
                  href="#" 
                  className="group flex items-center gap-4 text-2xl font-bold text-white hover:text-zinc-400 transition-colors"
                >
                  Download Resume <FileText className="w-6 h-6 group-hover:-translate-y-1 group-hover:translate-x-1 transition-transform" />
                </a>
             </div>
          </div>
          
          <div className="pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-4 text-xs font-mono text-zinc-600 uppercase tracking-widest">
             <span>&copy; 2025 Yash Solanki</span>
             <span>Built with React & Framer Motion</span>
          </div>
        </div>
      </footer>

      {/* Project Detail Modal */}
      <AnimatePresence>
        {selectedProject && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedProject(null)}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md cursor-auto"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-5xl bg-zinc-900 border border-zinc-800 overflow-hidden flex flex-col md:flex-row shadow-2xl"
            >
              {/* Close Button */}
              <button
                onClick={() => setSelectedProject(null)}
                className="absolute top-4 right-4 z-20 p-2 rounded-full bg-black text-white hover:bg-white hover:text-black transition-colors border border-white/10"
                data-hover="true"
              >
                <X className="w-6 h-6" />
              </button>

              {/* Navigation Buttons */}
              <button
                onClick={(e) => { e.stopPropagation(); navigateProject('prev'); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-black text-white hover:bg-white hover:text-black transition-colors border border-white/10 hidden md:block"
                data-hover="true"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>

              <button
                onClick={(e) => { e.stopPropagation(); navigateProject('next'); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-black text-white hover:bg-white hover:text-black transition-colors border border-white/10 hidden md:block"
                data-hover="true"
              >
                <ChevronRight className="w-6 h-6" />
              </button>

              {/* Image Side */}
              <div className="w-full md:w-1/2 h-64 md:h-auto relative overflow-hidden bg-black">
                <AnimatePresence mode="wait">
                  <motion.img 
                    key={selectedProject.id}
                    src={selectedProject.image} 
                    alt={selectedProject.name} 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4 }}
                    className="absolute inset-0 w-full h-full object-cover opacity-80"
                  />
                </AnimatePresence>
              </div>

              {/* Content Side */}
              <div className="w-full md:w-1/2 p-8 pb-12 md:p-16 flex flex-col justify-center relative bg-zinc-900">
                <motion.div
                  key={selectedProject.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.1 }}
                >
                  <div className="flex items-center gap-3 text-zinc-500 mb-6">
                     <Calendar className="w-4 h-4" />
                     <span className="font-mono text-xs tracking-widest uppercase">{selectedProject.year}</span>
                  </div>
                  
                  <h3 className="text-3xl md:text-4xl font-heading font-bold uppercase leading-none mb-3 text-white">
                    {selectedProject.name}
                  </h3>
                  
                  <p className="text-sm text-zinc-400 font-bold tracking-widest uppercase mb-8 border-b border-zinc-800 pb-4 inline-block">
                    {selectedProject.category}
                  </p>
                  
                  <p className="text-zinc-300 leading-relaxed text-base font-light mb-8">
                    {selectedProject.description}
                  </p>

                  <div className="flex gap-4">
                    <button className="border border-white/20 hover:bg-white hover:text-black text-white px-8 py-3 uppercase tracking-widest text-xs font-bold transition-all">
                      View Project
                    </button>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Helper component for Contact icons
const ArrowUpRight = ({ className }: { className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M7 17l9.2-9.2M17 17V7H7" />
  </svg>
);

export default App;
