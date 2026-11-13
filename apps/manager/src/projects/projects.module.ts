import { Module } from '@nestjs/common';
import { ManagerModule } from '../manager/manager.module';
import { ProjectService } from './services/project.service';

// Manages registered projects and their local roots.
@Module({ imports: [ManagerModule], providers: [ProjectService], exports: [ProjectService] })
export class ProjectsModule {}
