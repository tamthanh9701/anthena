import React from 'react';
import { Button, Modal, Input, Space } from 'antd';
import { CheckOutlined, CloseOutlined, ClockCircleOutlined } from '@ant-design/icons';

const { TextArea } = Input;

interface ReviewActionBarProps {
  onApprove: (note?: string) => void;
  onReject: (note?: string) => void;
  onDefer: (note?: string) => void;
  loading?: boolean;
  disabled?: boolean;
}

const ReviewActionBar: React.FC<ReviewActionBarProps> = ({
  onApprove,
  onReject,
  onDefer,
  loading = false,
  disabled = false,
}) => {
  const [modalVisible, setModalVisible] = React.useState(false);
  const [action, setAction] = React.useState<'approve' | 'reject' | 'defer'>('approve');
  const [note, setNote] = React.useState('');

  const showModal = (act: 'approve' | 'reject' | 'defer') => {
    setAction(act);
    setNote('');
    setModalVisible(true);
  };

  const handleConfirm = () => {
    if (action === 'approve') onApprove(note || undefined);
    else if (action === 'reject') onReject(note || undefined);
    else if (action === 'defer') onDefer(note || undefined);
    setModalVisible(false);
  };

  return (
    <>
      <Space>
        <Button
          type="primary"
          icon={<CheckOutlined />}
          onClick={() => showModal('approve')}
          loading={loading && action === 'approve'}
          disabled={disabled}
        >
          Approve
        </Button>
        <Button
          danger
          icon={<CloseOutlined />}
          onClick={() => showModal('reject')}
          loading={loading && action === 'reject'}
          disabled={disabled}
        >
          Reject
        </Button>
        <Button
          icon={<ClockCircleOutlined />}
          onClick={() => showModal('defer')}
          loading={loading && action === 'defer'}
          disabled={disabled}
        >
          Defer
        </Button>
      </Space>
      <Modal
        title={`${action.charAt(0).toUpperCase() + action.slice(1)} — Add Note (Optional)`}
        open={modalVisible}
        onOk={handleConfirm}
        onCancel={() => setModalVisible(false)}
        okText={action.charAt(0).toUpperCase() + action.slice(1)}
      >
        <TextArea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note for this action..."
          maxLength={2000}
          showCount
        />
      </Modal>
    </>
  );
};

export default ReviewActionBar;