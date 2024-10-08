import React, { useState, useEffect, useRef } from 'react';
import { Client, StompSubscription } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { useNavigate, useParams } from 'react-router-dom';
import Modal from '../../../components/modal/Modal';
import axios, { AxiosError } from 'axios';
import endpoints from '../../../api/endpoints';
import styles from './LiveStudent.module.css';
import { Container } from '../../../styles/GlobalStyles';
import { connectToServerAsStudent } from '../../../components/web-rtc/utils/student/studentClient';

// import images
import profileDefault1 from '../../../assets/images/profile/jellyfish.png';
import profileDefault2 from '../../../assets/images/profile/whale.png';
import profileDefault3 from '../../../assets/images/profile/crab.png';
import noCam from '../../../assets/images/icon/no_cam.png';
import share from '../../../assets/images/icon/share.png';
import audioOn from '../../../assets/images/icon/audio.png';
import audioOff from '../../../assets/images/icon/no_audio.png';

// icon
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane } from '@fortawesome/free-solid-svg-icons';

const profileImages = [profileDefault1, profileDefault2, profileDefault3];

interface Message {
  room: string;
  message: string;
  nickname: string;
  profileImage: string;
  time: string;
}

const LiveStudent: React.FC = () => {
  const token = localStorage.getItem('accessToken');
  const navigate = useNavigate();
  const { classId } = useParams<{ classId: string }>();
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState('');
  const [instructor, setInstructor] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('');
  const [subStatus, setSubStatus] = useState('');
  const [isSubscriptionDisabled, setIsSubscriptionDisabled] = useState(true);
  const [isScreenClicked, setIsScreenClicked] = useState(false);
  const [userInfo, setUserInfo] = useState<{ nickname: string; profileImage: string } | null>(null);

  // Chat 관련
  const [stompClient, setStompClient] = useState<Client | null>(null);
  const [currentRoom, setCurrentRoom] = useState(classId);
  const [subscription, setSubscription] = useState<StompSubscription | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [connected, setConnected] = useState(false);
  const [content, setContent] = useState("");

  const getProfileImage = (nickname: string | null): string => {
    const safeNickname = nickname || '익명';
    let hash = 0;
    for (let i = 0; i < safeNickname.length; i++) {
      hash = safeNickname.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash % profileImages.length);
    return profileImages[index];
  };

   // Wide View 관련
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth <= 1184);

  const setConnectedState = (connected: boolean) => {
    setConnected(connected);
    if (!connected) {
      setMessages([]);
    }
  };

  useEffect(() => {
    const connect = () => {
      const socket = new SockJS(endpoints.connectWebSocket);
      const client = new Client({
        webSocketFactory: () => socket,
        debug: (str) => {
          console.log('STOMP Debug:', str);
        },
        beforeConnect: () => {
          client.connectHeaders = {
            Authorization: `Bearer ${token}`
          };
        },
        onConnect: () => {
            setStompClient(client);
            setConnectedState(true);
  
            console.log('STOMP client connected');
        },
        onStompError: (frame) => {
            console.error('Broker reported error: ' + frame.headers['message']);
            console.error('Additional details: ' + frame.body);
        },
        onDisconnect: () => {
            setConnectedState(false);
            console.log("Disconnected");
        }
      });
  
      client.activate();
    }; 

    connect();
  }, [classId]); 

  // useEffect를 사용하여 stompClient 상태가 업데이트된 후 작업 수행
  useEffect(() => {
    if (stompClient && connected && currentRoom) {
      console.log(stompClient);
      console.log("Attempting to subscribe...");
      subscribeToRoom(currentRoom); // 현재 방에 구독
      loadChatHistory(currentRoom); // 현재 방의 채팅 기록 로드
    }
  }, [stompClient, connected, currentRoom]);

  const disconnect = () => {
    if (stompClient) {
      stompClient.deactivate();
      setConnectedState(false);
      console.log("Disconnected");
    }
  };

  const subscribeToRoom = (classId: string) => {
    if (!stompClient) {
      console.error('STOMP client is not initialized. Cannot subscribe.');
      return;
    }

    if (!stompClient.connected) {
      console.error('STOMP client is not connected. Cannot subscribe.');
      return;
    }

    if (subscription) {
      console.log('Unsubscribing from previous room');
      subscription.unsubscribe();  // 이전 방에 대한 구독 해제
    }
    
    console.log("Attempting to subscribe to roomId = " + classId);
    console.log("currentRoom = " + currentRoom);
    
    try {
      const newSubscription = stompClient.subscribe(`/topic/greetings/${classId}`, (greeting) => {
        console.log('Raw message received:', greeting.body); // raw data

        const messageContent = JSON.parse(greeting.body);
        const pf = messageContent.profile_image_path || getProfileImage(messageContent.writer);
        const tm = new Date(messageContent.createdDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        console.log(`Received message: ${messageContent.content}`);
        showGreeting(messageContent.roomId, messageContent.content, messageContent.writer, pf, tm);
      });

      setSubscription(newSubscription);
      console.log("Successfully subscribed to room " + classId);
    } catch (error) {
      console.error("Failed to subscribe: ", error);
    }
  };

  const sendMessage = () => {
    if (stompClient && stompClient.connected) {
      const chatMessage = {
        roomId: currentRoom,
        content: content,
        writer: userInfo ? userInfo.nickname : null,
        profile_image_path: userInfo?.profileImage,
        createdDate: new Date().toISOString()
      };

      // 메시지를 서버로 전송
      stompClient.publish({
        destination: "/app/hello",
        body: JSON.stringify(chatMessage),
      });

      setContent('');

      // 채팅 기록 다시 로드
      if (currentRoom) {
        loadChatHistory(currentRoom);
      }
    } else {
      console.error('STOMP client is not connected. Cannot send message.');
    }
  };

  const showGreeting = (room: string, message: string, nickname: string, profileImage: string, time: string) => {
    setMessages((prevMessages) => [
      ...prevMessages,
      { 
        room, 
        message, 
        nickname,
        profileImage,
        time
      }
    ]);
  };

  const loadChatHistory = (classId: string) => {
    axios.get(endpoints.getChatHistory.replace('{classId}', classId))
      .then(response => {
        console.log('Teacher-Server Response Data:', response.data);

        setMessages(response.data.map((msg:any) => ({
          room: msg.roomId,
          message: msg.content,
          nickname: msg.writer || '익명',
          profileImage: msg.profile_image_path || getProfileImage(msg.writer),
          time: new Date(msg.createdDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        })));
      })
      .catch(error => {
          console.error("Failed to load chat history:", error);
      });
  };

  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const screenShareVideoRef = useRef<HTMLVideoElement>(null);
  const chatWindowRef = useRef<HTMLDivElement>(null);

  // 유저 정보 조회
  useEffect(() => {
    const fetchUserInfo = async () => {
      try {
        const response = await axios.get(endpoints.userInfo, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.status === 200) {
          console.log('LiveStudent: 유저 정보를 정상적으로 받아왔습니다: ', response.data);
          setUserInfo(response.data.data);
        }
      } catch (error) {
        const axiosError = error as AxiosError;

        if (axiosError.response && axiosError.response.status === 401) {
            alert('권한이 없습니다.');
            navigate('/');
        } else {
            console.error('Error occurred: ', axiosError);
        }
      }
    };

    fetchUserInfo();
  }, [navigate, token]);

  // 페이지 로딩 시 강의 정보 가져오기
  useEffect(() => {
    const fetchLectureInfo = async () => {
      if (classId) {
        try {
          const response = await axios.get(endpoints.getLectureInfo.replace('{classId}', classId));
          const lectureData = response.data.data;
          setTitle(lectureData.name);
          setInstructor(lectureData.instructor);
        } catch (error) {
          console.error('LiveStudent: 강의 정보를 불러오는 데 실패했습니다 > ', error);
        }
      } else {
        console.error('Invalid classId');
      }
    };

    fetchLectureInfo();
  }, [classId]);

  // WebRTC Connection
  useEffect(() => {
    const handleConnect = async () => {
      await connectToServerAsStudent(
        classId ?? '',
        setConnectionStatus,
        setIsSubscriptionDisabled,
        webcamVideoRef,
        screenShareVideoRef
      );
    };

    if (classId) {
      handleConnect();
    }
  },[classId]);

  useEffect(() => {
    if (chatWindowRef.current) {
      chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
    }
  }, [messages]);

  // Modal handler
  const handleLeaveClick = () => {
    setShowModal(true);
  };

  const handleModalLeave = () => {
    setShowModal(false);
    navigate(-1); // 이전 화면으로 이동
  };

  const handleModalCancel = () => {
    setShowModal(false);
  };

  const handleScreenClick = () => {
    setIsScreenClicked((prev) => !prev);
  };

  // TO DO : 오디오 송출 동의 받기 
  // 토글 상태 추가
  const [isAudioOn, setIsAudioOn] = useState(false);

  // 오디오 토글 핸들러
  const handleToggleAudio = () => {};

  return (
    <>
      {isMobile ? (
      // 모바일 UI
    <Container>
      {showModal && (
        <Modal 
          title="강의를 종료하시겠습니까?"
          content="강의가 끝났나요?"
          rightButtonText="강의 나가기"
          onLeftButtonClick={handleModalCancel}
          onRightButtonClick={handleModalLeave}
          color={'var(--red-color)'}
        />
      )}
      <div className={styles.videoSection}>
        <div className={styles.screenShare}>
          <video 
            ref={screenShareVideoRef} 
            autoPlay 
            playsInline 
            muted 
            style={{ objectFit: isScreenClicked ? 'cover' : 'contain' }}
          />
        </div>
        <div className={styles.smallVideo}>
          <video 
            ref={webcamVideoRef} 
            autoPlay
            playsInline
            muted 
          />
        </div>
      </div>

      <div className={styles.info}>
        <div className={styles.column}>
          <h2 className={styles.title}>{title}</h2>
          <p className={styles.instructor}>{instructor}</p>
        </div>
        <button
          className={styles.audioButton} 
          onClick={handleToggleAudio} // 버튼 클릭 시 호출될 핸들러
          style={{ backgroundColor: isAudioOn ? '#4A4B4D' : '#FFFFFF' }} // 상태에 따라 색상 변경
        >
        <img src={isAudioOn ? audioOn : audioOff} alt="오디오" className={styles.icon} />
        </button>
      </div>

      <div className={styles.chatSection}>
        <div className={styles.chatWindow} ref={chatWindowRef}>
          {messages.map((msg, index) => {
            // 현재 사용자가 보낸 메시지인지 확인
            const isMyMessage = msg.nickname === userInfo?.nickname;
            
            return (
              <div
                key={index}
                className={`${styles.chat} ${isMyMessage ? styles.myChat : ''}`}
              >
                {!isMyMessage && (
                  <div className={styles.profContainer}>
                    <img src={msg.profileImage} alt="프로필" className={styles.icon} />
                  </div>
                )}
                <div className={styles.chatContainer}>
                  <div className={styles.chatInfo}>
                    {!isMyMessage && <h5>{msg.nickname}</h5>}
                    <p className={isMyMessage ? styles.myTime : styles.time}>{msg.time}</p>
                  </div>
                  <div className={`${styles.chatBubble} ${isMyMessage ? styles.myChatBubble : ''}`}>
                    <p>{msg.message}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className={styles.chatInput}>
          <textarea
            placeholder="채팅을 입력하세요."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            rows={1}
            style={{ resize: 'none', overflow: 'hidden' }}
          />
          <button 
            onClick={sendMessage}
            disabled={!connected}
          >
            Send
          </button>
        </div>
      </div>
    </Container>
    ) : (
      // ******************************************** //
      // 데스크톱 UI
      <div className={styles.desktopContainer}>
        {showModal && (
          <Modal 
            title="강의를 종료하시겠습니까?"
            content="강의가 끝났나요?"
            rightButtonText="강의 나가기"
            onLeftButtonClick={handleModalCancel}
            onRightButtonClick={handleModalLeave}
            color={'var(--red-color)'}
          />
        )}
        <div className={styles.desktopVideoSection}>
          <div className={styles.desktopScreenShare}>
            <video 
              ref={screenShareVideoRef} 
              autoPlay 
              playsInline 
              muted 
              style={{ objectFit: isScreenClicked ? 'cover' : 'contain' }}
            />
          </div>
          <div className={styles.desktopSmallVideo}>
            <video 
              ref={webcamVideoRef} 
              autoPlay
              playsInline
              muted 
            />
          </div>
        </div>

        <div className={styles.desktopInfo}>
          <h2 className={styles.title}>{title}</h2>
          <p className={styles.instructor}>{instructor}</p>
        </div>

        <div className={styles.desktopChatSection}>
          <div className={styles.desktopChatWindow} ref={chatWindowRef}>
          {messages.map((msg, index) => {
              const isMyMessage = msg.nickname === userInfo?.nickname;
              
              return (
                <div
                key={index}
                className={`${styles.desktopChat} ${isMyMessage ? styles.myChat : ''}`} // 내가 보낸 메시지일 때 추가 클래스
                >
                <div className={styles.chatContainer}>
                  <div className={styles.chatUserInfo}>
                  {/* 현재 사용자가 보낸 메시지일 때는 프로필 이미지 숨김 */}
                  {!isMyMessage && (
                    <div className={styles.desktopProfContainer}>
                      <img src={msg.profileImage} alt="프로필" className={styles.icon} />
                    </div>
                  )}
                  <div className={styles.desktopChatInfo}>
                      {!isMyMessage && <h5>{msg.nickname}</h5>}
                      <p>{msg.time}</p>
                    </div>
                  </div>
                  <div className={`${styles.desktopChatBubble} ${isMyMessage ? styles.desktopMyChatBubble : ''}`}>
                      <p>{msg.message}</p>
                    </div>
                </div>
              </div>);
            })}
          </div>
          <div className={styles.desktopChatBackground}>
            <div className={styles.desktopChatInput}>
              <textarea
                placeholder="채팅을 입력하세요."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                rows={1} // 기본 행의 높이 설정
                style={{ resize: 'none', overflow: 'hidden' }} // 크기 조정 방지 및 스크롤 숨김
              />
              <button 
                onClick={sendMessage}
                disabled={!connected}
              >
                <FontAwesomeIcon icon={faPaperPlane} />
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default LiveStudent;
