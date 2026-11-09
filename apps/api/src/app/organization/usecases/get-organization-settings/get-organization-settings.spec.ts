import { CommunityOrganizationRepository, OrganizationEntity } from '@novu/dal';
import { expect } from 'chai';
import sinon from 'sinon';
import { GetOrganizationSettingsCommand } from './get-organization-settings.command';
import { GetOrganizationSettings } from './get-organization-settings.usecase';

describe('GetOrganizationSettings (Djinn)', () => {
  it('сообщает об отсутствии клейма даже организации без флага', async () => {
    const organization = { _id: 'org', name: 'Spike' } as unknown as OrganizationEntity;
    const usecase = new GetOrganizationSettings(
      sinon.createStubInstance(CommunityOrganizationRepository) as unknown as CommunityOrganizationRepository
    );

    const settings = await usecase.execute(GetOrganizationSettingsCommand.create({ organizationId: 'org', organization }));

    expect(settings.removeNovuBranding).to.equal(true);
  });
});
