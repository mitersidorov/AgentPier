import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { AgentProfileService } from './services/agent-profile.service';
import { ManagerModule } from '../manager/manager.module';
import { ManagerService } from '../manager/services/manager.service';
import { CodexAppServerService } from '../integrations/codex/services/codex-app-server.service';
import { CodexModule } from '../integrations/codex/codex.module';

@Injectable()
class AgentProfileSeeder implements OnModuleInit {
  constructor(
    private readonly manager: ManagerService,
    private readonly profiles: AgentProfileService,
    private readonly codex: CodexAppServerService,
  ) {}
  async onModuleInit() {
    const profiles = await this.profiles.list();
    let models: Awaited<ReturnType<CodexAppServerService['listModels']>> = [];
    try {
      models = await this.codex.listModels();
    } catch {
      // Keep persisted model choices intact when the host app-server is unavailable.
    }
    const preferredDefault = models.find((model) => model.isDefault)?.id || models[0]?.id;
    const alternateDefault = models.find((model) => model.id !== preferredDefault)?.id;
    await this.manager.seedProfiles(
      profiles.map((profile) => ({
        role: profile.role,
        instructions: profile.profile,
        version: profile.version,
        defaultModel:
          profile.role === 'backend-nestjs'
            ? preferredDefault
            : profile.role === 'frontend-angular'
              ? alternateDefault
              : preferredDefault,
      })),
    );
  }
}

// Loads versioned agent profiles and seeds their current definitions.
@Module({
  imports: [CodexModule, ManagerModule],
  providers: [AgentProfileService, AgentProfileSeeder],
  exports: [AgentProfileService],
})
export class AgentsModule {}
